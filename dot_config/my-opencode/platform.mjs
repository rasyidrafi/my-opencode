// Keep Termux detection aligned with the chezmoi mise template.
export function currentPlatform(platform = process.platform, env = process.env) {
  if (platform === 'android' || env.TERMUX_VERSION || env.PREFIX?.startsWith('/data/data/com.termux/')) return 'android';
  return platform === 'win32' ? 'windows' : platform;
}

export function requireTaskPlatform(task, platforms, platform = process.platform, env = process.env) {
  const current = currentPlatform(platform, env);
  if (!platforms.includes(current)) {
    const label = current === 'windows' ? 'Windows yet' : current === 'android' ? 'Android/Termux' : current;
    throw new Error(task + ' is not supported on ' + label + '. Supported platforms: ' + platforms.join(', ') + '.');
  }
}
