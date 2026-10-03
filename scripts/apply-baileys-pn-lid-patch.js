import { createHash } from 'node:crypto';
import {
  chmodSync,
  closeSync,
  fchmodSync,
  fstatSync,
  fsyncSync,
  lstatSync,
  mkdtempSync,
  openSync,
  readFileSync,
  renameSync,
  rmdirSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const EXPECTED_BAILEYS_VERSION = '6.7.22';
const ORIGINAL_SOURCE_SHA256 = 'f5a7844e6a8e26d5c60ecf29735ee860dfd5d59276910d7abde0a659feb25e8c';
const PATCHED_SOURCE_SHA256 = '898d16331566320c612090ff8bba686e10dbd2c2705f729f425f924ff887e90e';

const originalImport = "import { areJidsSameUser, isJidBroadcast, isJidGroup, isJidMetaIa, isJidNewsletter, isJidStatusBroadcast, isJidUser, isLidUser } from '../WABinary/index.js';";
const patchedImport = "import { areJidsSameUser, isJidBroadcast, isJidGroup, isJidMetaIa, isJidNewsletter, isJidStatusBroadcast, isJidUser, isLidUser, jidNormalizedUser } from '../WABinary/index.js';";

const originalDecryptCase = `                            case 'pkmsg':
                            case 'msg':
                                const user = isJidUser(sender) ? sender : author;
                                msgBuffer = await repository.decryptMessage({
                                    jid: user,
                                    type: e2eType,
                                    ciphertext: content
                                });
                                break;
`;
const patchedDecryptCase = `                            case 'pkmsg':
                            case 'msg': {
                                const user = isJidUser(sender) ? sender : author;
                                try {
                                    msgBuffer = await repository.decryptMessage({
                                        jid: user,
                                        type: e2eType,
                                        ciphertext: content
                                    });
                                }
                                catch (error) {
                                    const isGroup = isJidGroup(stanza.attrs.from);
                                    const pairedPn = isGroup ? stanza.attrs.participant_pn : stanza.attrs.sender_pn;
                                    const pairedLid = isGroup ? stanza.attrs.participant_lid : stanza.attrs.sender_lid;
                                    const primaryPairAddress = isJidUser(user) ? pairedPn : isLidUser(user) ? pairedLid : undefined;
                                    const alternateAddress = isJidUser(user) ? pairedLid : isLidUser(user) ? pairedPn : undefined;
                                    const normalizedUser = jidNormalizedUser(user);
                                    if (!hasDistinctNormalizedJids(user, alternateAddress)
                                        || !isJidUser(pairedPn) || !isLidUser(pairedLid)
                                        || !primaryPairAddress || !alternateAddress
                                        || !normalizedUser
                                        || jidNormalizedUser(primaryPairAddress) !== normalizedUser) {
                                        throw error;
                                    }
                                    try {
                                        msgBuffer = await repository.decryptMessage({
                                            jid: alternateAddress,
                                            type: e2eType,
                                            ciphertext: content
                                        });
                                    }
                                    catch {
                                        throw error;
                                    }
                                }
                                break;
                            }
`;
const decryptFunctionAnchor = 'export const decryptMessageNode = (stanza, meId, meLid, repository, logger) => {';
const normalizedJidHelper = `export const hasDistinctNormalizedJids = (primaryJid, alternateJid) => {
    if (!primaryJid || !alternateJid) {
        return false;
    }
    const normalizedPrimary = jidNormalizedUser(primaryJid);
    const normalizedAlternate = jidNormalizedUser(alternateJid);
    return Boolean(normalizedPrimary && normalizedAlternate && normalizedPrimary !== normalizedAlternate);
};

`;

const sha256 = (value) => createHash('sha256').update(value, 'utf8').digest('hex');

function replaceExactlyOnce(source, expected, replacement, label) {
  const first = source.indexOf(expected);
  if (first === -1 || source.indexOf(expected, first + expected.length) !== -1) {
    throw new Error(`Expected exactly one unambiguous ${label} snippet.`);
  }
  return `${source.slice(0, first)}${replacement}${source.slice(first + expected.length)}`;
}

function removeOwnedTemporaryFile(tempPath, identity) {
  if (!identity) return;
  try {
    const candidate = lstatSync(tempPath);
    if (candidate.isFile()
      && !candidate.isSymbolicLink()
      && candidate.dev === identity.dev
      && candidate.ino === identity.ino) {
      unlinkSync(tempPath);
    }
  } catch {
    // Missing, replaced, or otherwise unremovable paths are never followed or recursively removed.
  }
}

function removeOwnedTemporaryDirectory(tempDirectory, identity) {
  if (!identity) return;
  const candidate = lstatSync(tempDirectory);
  if (!candidate.isDirectory()
    || candidate.isSymbolicLink()
    || candidate.dev !== identity.dev
    || candidate.ino !== identity.ino) {
    throw new Error('Baileys patch temp directory changed; refusing to remove it.');
  }
  rmdirSync(tempDirectory);
}

export function replaceDecoderAtomically(decoderPath, contents) {
  const initialTarget = lstatSync(decoderPath);
  if (!initialTarget.isFile() || initialTarget.isSymbolicLink()) {
    throw new Error('Refusing to replace a non-regular Baileys decoder file.');
  }
  const targetMode = initialTarget.mode & 0o777;
  const temporaryDirectory = mkdtempSync(join(dirname(decoderPath), '.baileys-pn-lid-'));
  const temporaryPath = join(temporaryDirectory, 'decode-wa-message.js');
  let descriptor;
  let temporaryIdentity;
  let temporaryDirectoryIdentity;
  let renamed = false;

  try {
    const createdDirectory = lstatSync(temporaryDirectory);
    if (!createdDirectory.isDirectory() || createdDirectory.isSymbolicLink()) {
      throw new Error('Baileys patch temp directory is not a regular directory.');
    }
    temporaryDirectoryIdentity = { dev: createdDirectory.dev, ino: createdDirectory.ino };
    chmodSync(temporaryDirectory, 0o700);
    descriptor = openSync(temporaryPath, 'wx', 0o600);
    const createdFile = fstatSync(descriptor);
    temporaryIdentity = { dev: createdFile.dev, ino: createdFile.ino };
    writeFileSync(descriptor, contents, { encoding: 'utf8' });
    fchmodSync(descriptor, targetMode);
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = undefined;

    const currentTarget = lstatSync(decoderPath);
    if (!currentTarget.isFile()
      || currentTarget.isSymbolicLink()
      || currentTarget.dev !== initialTarget.dev
      || currentTarget.ino !== initialTarget.ino) {
      throw new Error('Baileys decoder changed during patching; refusing to replace it.');
    }

    renameSync(temporaryPath, decoderPath);
    renamed = true;
    removeOwnedTemporaryDirectory(temporaryDirectory, temporaryDirectoryIdentity);
  } catch (error) {
    if (descriptor !== undefined) {
      try {
        closeSync(descriptor);
      } catch {
        // Preserve the original patching error.
      }
    }
    if (!renamed) {
      removeOwnedTemporaryFile(temporaryPath, temporaryIdentity);
    }
    try {
      removeOwnedTemporaryDirectory(temporaryDirectory, temporaryDirectoryIdentity);
    } catch {
      // A replaced, non-empty, or otherwise unremovable directory is never removed.
    }
    throw error;
  }
}

export function transformDecoderSource(source) {
  const sourceHash = sha256(source);
  if (sourceHash === PATCHED_SOURCE_SHA256) {
    return { source, changed: false };
  }
  if (sourceHash !== ORIGINAL_SOURCE_SHA256) {
    throw new Error(`Unexpected Baileys decoder fingerprint ${sourceHash}; refusing to patch.`);
  }

  let patched = replaceExactlyOnce(source, originalImport, patchedImport, 'WABinary import');
  patched = replaceExactlyOnce(patched, originalDecryptCase, patchedDecryptCase, 'msg/pkmsg decrypt case');
  patched = replaceExactlyOnce(patched, decryptFunctionAnchor, `${normalizedJidHelper}${decryptFunctionAnchor}`, 'decoder function anchor');

  const patchedHash = sha256(patched);
  if (patchedHash !== PATCHED_SOURCE_SHA256) {
    throw new Error(`Patched Baileys decoder fingerprint ${patchedHash} did not match the expected output.`);
  }
  return { source: patched, changed: true };
}

const defaultProjectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export function applyBaileysPatch(projectRoot = defaultProjectRoot, sourceTransformer = transformDecoderSource) {
  const packageRoot = join(projectRoot, 'node_modules', '@whiskeysockets', 'baileys');
  const packageJsonPath = join(packageRoot, 'package.json');
  const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
  if (packageJson.version !== EXPECTED_BAILEYS_VERSION) {
    throw new Error(`Expected @whiskeysockets/baileys ${EXPECTED_BAILEYS_VERSION}, found ${packageJson.version}; refusing to patch.`);
  }

  const decoderPath = join(packageRoot, 'lib', 'Utils', 'decode-wa-message.js');
  const originalSource = readFileSync(decoderPath, 'utf8');
  const { source: patchedSource, changed } = sourceTransformer(originalSource);
  if (!changed) {
    return false;
  }

  replaceDecoderAtomically(decoderPath, patchedSource);
  return true;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const changed = applyBaileysPatch();
    console.log(changed
      ? 'Applied the verified Baileys 6.7.22 PN/LID fallback patch.'
      : 'Verified the Baileys 6.7.22 PN/LID fallback patch is already applied.');
  } catch (error) {
    console.error(`[baileys-pn-lid-postinstall] ${error.message}`);
    process.exitCode = 1;
  }
}
