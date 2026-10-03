import { createHash } from 'node:crypto';
import {
  readFileSync,
  renameSync,
  statSync,
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

export function applyBaileysPatch(projectRoot = defaultProjectRoot) {
  const packageRoot = join(projectRoot, 'node_modules', '@whiskeysockets', 'baileys');
  const packageJsonPath = join(packageRoot, 'package.json');
  const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
  if (packageJson.version !== EXPECTED_BAILEYS_VERSION) {
    throw new Error(`Expected @whiskeysockets/baileys ${EXPECTED_BAILEYS_VERSION}, found ${packageJson.version}; refusing to patch.`);
  }

  const decoderPath = join(packageRoot, 'lib', 'Utils', 'decode-wa-message.js');
  const originalSource = readFileSync(decoderPath, 'utf8');
  const { source: patchedSource, changed } = transformDecoderSource(originalSource);
  if (!changed) {
    return false;
  }

  const temporaryPath = `${decoderPath}.${process.pid}.tmp`;
  const mode = statSync(decoderPath).mode & 0o777;
  try {
    writeFileSync(temporaryPath, patchedSource, { encoding: 'utf8', mode });
    renameSync(temporaryPath, decoderPath);
  } catch (error) {
    try {
      unlinkSync(temporaryPath);
    } catch {
      // Keep the original write/rename error.
    }
    throw error;
  }
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
