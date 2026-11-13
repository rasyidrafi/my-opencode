import contextlib
import importlib.util
import io
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('service', Path(__file__).with_name('service.py'))
service = importlib.util.module_from_spec(spec)
spec.loader.exec_module(service)


class Integration(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.fragment = self.root / 'cloudflared.service'
        self.fragment.write_text('[Unit]\nDescription=Tunnel\n[Service]\nType=notify\nExecStart=/old/cloudflared --no-autoupdate tunnel run --token SECRET\nRestart=on-failure\n')
        # The production validator rejects group-writable service files; make
        # fixture permissions deterministic under permissive caller umasks.
        self.fragment.chmod(0o644)
        self.binary = self.root / 'new' / 'cloudflared'
        self.binary.parent.mkdir()
        self.binary.write_text('fixture')
        self.binary.chmod(0o700)
        self.directory = self.root / 'cloudflared.service.d'
        self.override = self.directory / '90-my-opencode.conf'
        self.legacy_override = self.directory / '85-my-opencode.conf'
        self.transport = self.directory / '95-transport.conf'
        self.info = dict(LoadState='loaded', ActiveState='active', SubState='running', MainPID='123456789', FragmentPath=str(self.fragment), DropInPaths='')
        self.calls = []
        self.fail_restart = False
        self.wrong_path = False
        self.fail_reload = False
        self.patches = [
            patch.object(service, 'DIRECTORY', self.directory),
            patch.object(service, 'OVERRIDE', self.override),
            patch.object(service, 'OWNER', os.getuid()),
            patch.object(service, 'safe_directory'),
            patch.object(service, 'systemctl', self.systemctl),
            patch.object(service.os, 'readlink', lambda path: '/old/cloudflared' if self.wrong_path else str(self.binary)),
        ]
        original_stat = os.stat
        self.patches.append(patch.object(service.os, 'stat', lambda path, *a, **kw: original_stat(self.binary if str(path) == '/proc/123456789/exe' else path, *a, **kw)))
        for item in self.patches:
            item.start()
            self.addCleanup(item.stop)

    def systemctl(self, *args):
        self.calls.append(args)
        if args[0] == 'show':
            values = dict(self.info)
            values['DropInPaths'] = self.info.get('DropInPaths') or (' '.join(str(path) for path in sorted(self.directory.glob('*.conf')) if path.is_file()) if self.directory.exists() else '')
            return '\n'.join(f'{key}={value}' for key, value in values.items())
        if args[0] == 'try-restart' and self.fail_restart:
            raise RuntimeError('simulated restart failure')
        if args[0] == 'daemon-reload' and self.fail_reload:
            self.fail_reload = False
            raise RuntimeError('simulated reload failure')
        return ''

    def invoke(self, operation):
        output = io.StringIO()
        with contextlib.redirect_stdout(output):
            service.manage(dict(operation=operation, binary=str(self.binary)))
        self.assertNotIn('SECRET', output.getvalue())
        return output.getvalue()

    def test_setup_preserves_arguments_private_and_idempotent(self):
        self.invoke('setup')
        content = self.override.read_text()
        self.assertIn(f'ExecStart={self.binary} --no-autoupdate tunnel run --token SECRET', content)
        self.assertEqual(self.override.stat().st_mode & 0o777, 0o600)
        self.invoke('setup')
        self.assertEqual(content, self.override.read_text())
        self.assertFalse(any(c[0] in ('try-restart', 'restart') for c in self.calls))

    def test_setup_merges_transport_setting_and_removes_extra_dropin(self):
        self.directory.mkdir()
        self.transport.write_text('[Service]\nEnvironment=TUNNEL_TRANSPORT_PROTOCOL=http2\n')
        self.transport.chmod(0o644)
        self.info['DropInPaths'] = str(self.transport)
        output = self.invoke('setup')
        self.assertIn('Run cloudflared:restart', output)
        self.assertIn('Environment=TUNNEL_TRANSPORT_PROTOCOL=http2', self.override.read_text())
        self.assertFalse(self.transport.exists())
        self.assertEqual(self.override.stat().st_mode & 0o777, 0o600)
        self.assertIn(('daemon-reload',), self.calls)
        self.assertFalse(any(c[0] in ('try-restart', 'restart') for c in self.calls))

    def test_restart_merges_transport_and_uses_pinned_binary(self):
        self.directory.mkdir()
        self.invoke('setup')
        self.transport.write_text('[Service]\nEnvironment=TUNNEL_TRANSPORT_PROTOCOL=http2\n')
        self.transport.chmod(0o644)
        self.info['DropInPaths'] = ''
        self.invoke('restart')
        self.assertIn('Environment=TUNNEL_TRANSPORT_PROTOCOL=http2', self.override.read_text())
        self.assertFalse(self.transport.exists())
        self.assertIn(('try-restart', '--job-mode=fail', service.UNIT), self.calls)

    def test_transport_merge_failure_restores_legacy_dropin(self):
        self.directory.mkdir()
        content = '[Service]\nEnvironment=TUNNEL_TRANSPORT_PROTOCOL=http2\n'
        self.transport.write_text(content)
        self.transport.chmod(0o644)
        self.info['DropInPaths'] = str(self.transport)
        self.fail_reload = True
        with self.assertRaisesRegex(RuntimeError, 'previous drop-in restored'):
            self.invoke('setup')
        self.assertEqual(self.transport.read_text(), content)
        self.assertFalse(self.override.exists())

    def test_arbitrary_service_dropins_are_consolidated(self):
        self.directory.mkdir()
        self.transport.write_text('[Service]\nEnvironment=TUNNEL_TRANSPORT_PROTOCOL=http2\nRestart=always\n')
        self.transport.chmod(0o644)
        self.info['DropInPaths'] = str(self.transport)
        self.invoke('setup')
        content = self.override.read_text()
        self.assertIn('Environment=TUNNEL_TRANSPORT_PROTOCOL=http2', content)
        self.assertIn('Restart=always', content)
        self.assertEqual(sum(line.strip() == '[Service]' for line in content.splitlines()), 1)
        self.assertFalse(self.transport.exists())

    def test_restart_consolidates_and_switches_without_prior_setup(self):
        self.directory.mkdir()
        self.transport.write_text('[Service]\nEnvironment=TUNNEL_TRANSPORT_PROTOCOL=http2\n')
        self.transport.chmod(0o644)
        self.info['DropInPaths'] = str(self.transport)
        self.invoke('restart')
        self.assertTrue(self.override.exists())
        self.assertIn('Environment=TUNNEL_TRANSPORT_PROTOCOL=http2', self.override.read_text())
        self.assertFalse(self.transport.exists())
        self.assertIn(('try-restart', '--job-mode=fail', service.UNIT), self.calls)

    def test_restart_switches_pin_and_verifies_path(self):
        self.invoke('setup')
        old = self.override.read_text().replace(str(self.binary), '/old/cloudflared')
        self.override.write_text(old)
        self.assertIn('pinned executable', self.invoke('restart'))
        self.assertIn(str(self.binary), self.override.read_text())
        self.assertIn(('try-restart', '--job-mode=fail', service.UNIT), self.calls)

    def test_unrelated_dropin_rejected(self):
        external = self.root / 'global.d' / 'custom.conf'
        external.parent.mkdir()
        external.write_text('[Service]\nRestart=always\n')
        self.info['DropInPaths'] = str(external)
        self.invoke('setup')
        self.assertTrue(self.override.exists())
        self.assertIn('External drop-ins retained', self.override.read_text())
        self.assertTrue(external.exists())

    def test_legacy_managed_override_is_consolidated_into_canonical_dropin(self):
        self.directory.mkdir()
        self.legacy_override.write_text(service.render(self.fragment.read_text(), str(self.binary)))
        self.legacy_override.chmod(0o600)
        self.info['DropInPaths'] = str(self.legacy_override)
        self.invoke('setup')
        self.assertTrue(self.override.exists())
        self.assertFalse(self.legacy_override.exists())
        self.assertIn(str(self.binary), self.override.read_text())

    def test_missing_inactive_failed_and_exited_rejected(self):
        for changes in [dict(LoadState='not-found'), dict(ActiveState='inactive'), dict(ActiveState='failed'), dict(SubState='exited')]:
            with patch.dict(self.info, changes):
                with self.assertRaisesRegex(RuntimeError, 'already be installed and running'):
                    self.invoke('setup')
        self.assertFalse(self.override.exists())

    def test_restart_failure_rolls_back_and_recovers(self):
        self.invoke('setup')
        old = self.override.read_text().replace(str(self.binary), '/old/cloudflared')
        self.override.write_text(old)
        self.fail_restart = True
        with self.assertRaisesRegex(RuntimeError, 'previous drop-in restored'):
            self.invoke('restart')
        self.assertEqual(self.override.read_text(), old)
        self.assertIn(('restart', service.UNIT), self.calls)

    def test_wrong_process_path_fails_and_rolls_back(self):
        self.invoke('setup')
        self.wrong_path = True
        with self.assertRaisesRegex(RuntimeError, 'previous drop-in restored'):
            self.invoke('restart')
        self.assertIn(('restart', service.UNIT), self.calls)

    def test_wrong_executable_inode_fails_verification(self):
        self.invoke('setup')
        with patch.object(service.os.path, 'samestat', return_value=False):
            with self.assertRaisesRegex(RuntimeError, 'previous drop-in restored'):
                self.invoke('restart')

    def test_recovery_failure_is_reported(self):
        self.invoke('setup')
        original = self.systemctl

        def failing(*args):
            if args[0] in ('try-restart', 'restart'):
                raise RuntimeError('simulated failure')
            return original(*args)

        with patch.object(service, 'systemctl', failing):
            with self.assertRaisesRegex(RuntimeError, 'recovery failed'):
                self.invoke('restart')

    def test_service_stopping_during_reload_is_not_started(self):
        self.invoke('setup')
        original = self.systemctl

        def stopping(*args):
            if args[0] == 'daemon-reload':
                self.info['ActiveState'] = 'inactive'
            return original(*args)

        self.calls.clear()
        with patch.object(service, 'systemctl', stopping):
            with self.assertRaises(RuntimeError):
                self.invoke('restart')
        self.assertFalse(any(c[0] in ('try-restart', 'restart') for c in self.calls))

    def test_setup_reload_failure_removes_new_override(self):
        self.fail_reload = True
        with self.assertRaisesRegex(RuntimeError, 'previous drop-in restored'):
            self.invoke('setup')
        self.assertFalse(self.override.exists())

    def test_unmanaged_modified_and_symlink_override_rejected(self):
        self.directory.mkdir()
        self.override.write_text('unmanaged')
        self.override.chmod(0o600)
        with self.assertRaisesRegex(RuntimeError, 'unmanaged'):
            self.invoke('setup')
        self.override.write_text(service.HEADER + 'unexpected')
        with self.assertRaisesRegex(RuntimeError, 'modified'):
            self.invoke('setup')
        self.override.unlink()
        self.override.symlink_to(self.fragment)
        with self.assertRaisesRegex(RuntimeError, 'symlinked'):
            self.invoke('setup')

    def test_unsupported_commands_rejected_without_leaking_secrets(self):
        for command in ['/bin/sh -c SECRET', '-/old/cloudflared SECRET', '/old/cloudflared tunnel run SECRET', '/old/cloudflared --no-autoupdate SECRET\\', '/old/cloudflared --no-autoupdate SECRET\nExecStart=/other/cloudflared SECRET']:
            with self.assertRaises(RuntimeError) as caught:
                service.render('[Service]\nExecStart=' + command + '\n', str(self.binary))
            self.assertNotIn('SECRET', str(caught.exception))


if __name__ == '__main__':
    unittest.main()
