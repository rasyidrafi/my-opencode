// Termux's SELinux policy can deny hard links even within app-private storage.
// Preserve T3's no-clobber publication: copy beside the destination, then use
// renameat2(RENAME_NOREPLACE). The source remains available to T3's cleanup code.
const fs = require('node:fs');
const {randomUUID} = require('node:crypto');
const {fileURLToPath} = require('node:url');
const {syncBuiltinESMExports} = require('node:module');
const {renameExclusive} = require('./rename.node');
const originalLink = fs.link.bind(fs);
const originalLinkSync = fs.linkSync.bind(fs);
const denied = error => ['EACCES', 'EPERM'].includes(error.code);
const filePath = value => value instanceof URL ? fileURLToPath(value) : String(value);

function publishCopy(source, destination) {
  const target = filePath(destination);
  const temporary = target + '.t3-publish-' + randomUUID();
  try {
    fs.copyFileSync(source, temporary, fs.constants.COPYFILE_EXCL);
    renameExclusive(temporary, target);
  } finally {
    try { fs.unlinkSync(temporary); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
}

fs.linkSync = function(source, destination) {
  try { return originalLinkSync(source, destination); }
  catch (error) {
    if (!denied(error)) throw error;
    return publishCopy(source, destination);
  }
};
fs.link = function(source, destination, callback) {
  originalLink(source, destination, error => {
    if (!error || !denied(error)) return callback(error);
    try { publishCopy(source, destination); }
    catch (fallbackError) { return callback(fallbackError); }
    callback(null);
  });
};
fs.promises.link = (source, destination) => new Promise((resolve, reject) => {
  fs.link(source, destination, error => error ? reject(error) : resolve());
});
syncBuiltinESMExports();
