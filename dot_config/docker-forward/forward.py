#!/usr/bin/python3
"""Reconcile a remote Docker context's published TCP ports with guest loopback."""
import argparse
import json
import signal
import socket
import subprocess
import threading


def log(message):
    print(message, flush=True)


def desired_ports(containers):
    ports = {}
    for container in containers:
        if not container.get('State', {}).get('Running', False):
            continue
        for port, bindings in (container['NetworkSettings']['Ports'] or {}).items():
            if not port.endswith('/tcp'):
                continue
            for binding in bindings or []:
                number = int(binding['HostPort'])
                host = binding['HostIp']
                target = {'': '127.0.0.1', '0.0.0.0': '127.0.0.1', '::': '::1'}.get(host, host)
                ports.setdefault(number, set()).add(target)
    desired = {}
    for port, targets in ports.items():
        # Dual-stack wildcard publication is one destination, not a conflict.
        if targets == {'127.0.0.1', '::1'}:
            targets = {'127.0.0.1'}
        if len(targets) != 1:
            raise ValueError(f'Host port {port} has multiple bind addresses: {sorted(targets)}; cannot map unambiguously to localhost')
        for address in ('127.0.0.1', '::1'):
            desired[address, port] = next(iter(targets))
    return desired


def docker(config, *args):
    return subprocess.check_output(
        ['/usr/bin/docker', '--context', config['context'], *args], text=True, timeout=30)


def published(config):
    endpoint = docker(config, 'context', 'inspect', config['context'], '--format', '{{.Endpoints.docker.Host}}').strip()
    if endpoint != 'ssh://' + config['ssh_alias']:
        raise ValueError('Docker context endpoint changed; rerun docker:forward:setup')
    ids = docker(config, 'ps', '-q').split()
    containers = []
    for offset in range(0, len(ids), 100):
        containers.extend(json.loads(docker(config, 'inspect', *ids[offset:offset + 100])))
    return desired_ports(containers)


def bind_error(address, port):
    family = socket.AF_INET6 if ':' in address else socket.AF_INET
    try:
        with socket.socket(family, socket.SOCK_STREAM) as probe:
            if family == socket.AF_INET6:
                probe.setsockopt(socket.IPPROTO_IPV6, socket.IPV6_V6ONLY, 1)
            probe.bind((address, port))
    except OSError as error:
        return str(error)
    return None


def terminate(process):
    if process.poll() is not None:
        process.wait()
        return
    process.terminate()
    try:
        process.wait(timeout=5)
    except subprocess.TimeoutExpired:
        process.kill()
        process.wait()


def ssh_command(alias, address, port, target):
    local = f'[{address}]' if ':' in address else address
    remote = f'[{target}]' if ':' in target else target
    return ['/usr/bin/ssh', '-NTn', '-S', 'none',
            '-o', 'ClearAllForwardings=no', '-o', 'ExitOnForwardFailure=yes',
            '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes',
            '-o', 'ConnectTimeout=10', '-o', 'ServerAliveInterval=15',
            '-o', 'ServerAliveCountMax=3',
            '-L', f'{local}:{port}:{remote}:{port}', alias]


class Forwarder:
    def __init__(self, alias):
        self.alias = alias
        self.children = {}
        self.reported = {}

    def reconcile(self, desired):
        for key, (target, process) in list(self.children.items()):
            if desired.get(key) != target or process.poll() is not None:
                log(f'Removing/retrying tunnel {key}: exit={process.poll()}')
                terminate(process)
                del self.children[key]
        self.reported = {key: value for key, value in self.reported.items() if key in desired}
        for (address, port), target in desired.items():
            key = (address, port)
            if key in self.children:
                continue
            error = bind_error(address, port)
            if error:
                if self.reported.get(key) != error:
                    log(f'Cannot bind {address}:{port}: {error}; existing listeners are preserved')
                    self.reported[key] = error
                continue
            self.reported.pop(key, None)
            process = subprocess.Popen(ssh_command(self.alias, address, port, target))
            self.children[key] = (target, process)
            # SSH confirms bind failures via ExitOnForwardFailure; process liveness
            # is not proof that the remote application is ready to serve requests.
            log(f'Starting tunnel {address}:{port} -> {self.alias}:{target}:{port} (pid {process.pid})')

    def close(self):
        for _, process in self.children.values():
            if process.poll() is None:
                process.terminate()
        for _, process in self.children.values():
            terminate(process)
        self.children.clear()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--config', required=True)
    args = parser.parse_args()
    with open(args.config, encoding='utf-8') as source:
        config = json.load(source)
    interval = int(config['interval'])
    if interval < 1:
        raise ValueError('Polling interval must be positive')
    stopped = threading.Event()
    for signum in (signal.SIGTERM, signal.SIGINT):
        signal.signal(signum, lambda *_: stopped.set())
    forwarder = Forwarder(config['ssh_alias'])
    try:
        while not stopped.is_set():
            try:
                desired = published(config)
                if not stopped.is_set():
                    forwarder.reconcile(desired)
            except (subprocess.SubprocessError, OSError, ValueError, KeyError) as error:
                # A failed discovery is not an empty Docker host. Preserve tunnels
                # until a complete successful snapshot can be reconciled.
                log(f'Docker discovery/reconciliation failed; retrying: {error}')
            stopped.wait(interval)
    finally:
        forwarder.close()


if __name__ == '__main__':
    main()
