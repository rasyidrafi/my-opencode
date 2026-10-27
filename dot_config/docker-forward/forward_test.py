import unittest
from unittest.mock import Mock, patch

from forward import Forwarder, desired_ports, published, ssh_command


def container(ports, running=True):
    return {'State': {'Running': running}, 'NetworkSettings': {'Ports': ports}}


class ForwardTests(unittest.TestCase):
    def test_published_tcp_only_and_dual_stack(self):
        ports = desired_ports([container({
            '80/tcp': [{'HostIp': '0.0.0.0', 'HostPort': '18020'},
                       {'HostIp': '::', 'HostPort': '18020'}],
            '53/udp': [{'HostIp': '0.0.0.0', 'HostPort': '53'}],
            '9000/tcp': None,
        }), container({'90/tcp': [{'HostIp': '0.0.0.0', 'HostPort': '90'}]}, False)])
        self.assertEqual(ports, {('127.0.0.1', 18020): '127.0.0.1', ('::1', 18020): '127.0.0.1'})

    def test_ambiguous_host_bindings_are_not_arbitrarily_selected(self):
        with self.assertRaisesRegex(ValueError, 'multiple bind addresses'):
            desired_ports([container({'80/tcp': [
                {'HostIp': '192.0.2.1', 'HostPort': '8080'},
                {'HostIp': '192.0.2.2', 'HostPort': '8080'},
            ]})])

    def test_ipv6_only_target_and_ssh_failure_detection(self):
        ports = desired_ports([container({'80/tcp': [{'HostIp': '::', 'HostPort': '8080'}]})])
        self.assertEqual(ports['127.0.0.1', 8080], '::1')
        args = ssh_command('other-docker', '::1', 8080, '::1')
        self.assertIn('[::1]:8080:[::1]:8080', args)
        self.assertIn('ExitOnForwardFailure=yes', args)
        self.assertEqual(args[-1], 'other-docker')

    @patch('forward.docker', return_value='ssh://changed-host')
    def test_endpoint_drift_blocks_discovery(self, docker):
        with self.assertRaisesRegex(ValueError, 'endpoint changed'):
            published({'context': 'test', 'ssh_alias': 'test-host'})
        self.assertEqual(docker.call_count, 1)

    @patch('forward.log')
    @patch('forward.bind_error', return_value=None)
    @patch('forward.subprocess.Popen')
    def test_add_preserve_remove_and_restart_dead_tunnel(self, popen, bind, log):
        first, second = Mock(), Mock()
        first.poll.return_value = None
        second.poll.return_value = None
        popen.side_effect = [first, second]
        manager = Forwarder('test-host')
        desired = {('127.0.0.1', 8080): '127.0.0.1'}
        manager.reconcile(desired)
        manager.reconcile(desired)
        self.assertEqual(popen.call_count, 1)
        first.poll.return_value = 255
        manager.reconcile(desired)
        self.assertEqual(popen.call_count, 2)
        manager.reconcile({})
        second.terminate.assert_called_once()
        self.assertEqual(manager.children, {})

    @patch('forward.log')
    @patch('forward.bind_error', return_value='Address already in use')
    @patch('forward.subprocess.Popen')
    def test_conflict_retries_without_replacing_existing_listener(self, popen, bind, log):
        manager = Forwarder('test-host')
        desired = {('127.0.0.1', 8080): '127.0.0.1'}
        manager.reconcile(desired)
        manager.reconcile(desired)
        popen.assert_not_called()
        self.assertEqual(log.call_count, 1)
        bind.return_value = None
        manager.reconcile(desired)
        popen.assert_called_once()


if __name__ == '__main__':
    unittest.main()
