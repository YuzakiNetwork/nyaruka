import { downloadDirectVideo, parseAllowedHosts, validateDownloadUrl } from '../../lib/media/direct-video-downloader.js';
import { createBoundedQueue } from '../../lib/utils/bounded-queue.js';

const downloadQueue = createBoundedQueue({ concurrency: 2, maxQueued: 4 });
const ACCEPTED_MESSAGE = '⏬ Link diterima. Sedang menyiapkan file…';
const PLATFORM_UNSUPPORTED_MESSAGE = '⚠️ Link dari YouTube, TikTok, X, Instagram, dan platform sosial lain belum bisa diunduh lewat Nyaruka. Gunakan opsi resmi di platform atau kirim tautan HTTPS langsung ke file video yang memang boleh kamu unduh.';
const FEATURE_DISABLED_MESSAGE = '⚠️ Fitur download belum diaktifkan. Minta admin mengonfigurasi domain file tepercaya.';
const DOMAIN_UNSUPPORTED_MESSAGE = '⚠️ Domain ini belum didukung. Gunakan tautan HTTPS langsung dari domain yang diizinkan.';
const INVALID_URL_MESSAGE = '❌ Kirim URL HTTPS langsung ke file video MP4.';
const FETCH_ERROR_MESSAGE = '❌ File tidak bisa diambil. Cek apakah tautannya masih aktif dan dapat diakses.';
const SEND_ERROR_MESSAGE = '❌ Video berhasil diambil, tetapi tidak bisa dikirim. Coba lagi nanti.';
const QUEUE_FULL_MESSAGE = '⚠️ Antrean unduhan sedang penuh. Coba lagi sebentar.';
const REPLY_TIMEOUT_MS = 5_000;
const MEDIA_SEND_TIMEOUT_MS = 30_000;

function withTimeout(promise, timeoutMs) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error('send_timeout')), timeoutMs);
  });
  return Promise.race([Promise.resolve(promise), timeout]).finally(() => clearTimeout(timer));
}

async function safeReply(message, text, timeoutMs = REPLY_TIMEOUT_MS) {
  try {
    await withTimeout(message.reply(text), timeoutMs);
    return true;
  } catch {
    return false;
  }
}

function replyWithoutBlocking(message, text, timeoutMs = REPLY_TIMEOUT_MS) {
  void safeReply(message, text, timeoutMs);
}

function userFacingError(error) {
  if (error?.code === 'unsupported_platform') return PLATFORM_UNSUPPORTED_MESSAGE;
  if (error?.code === 'invalid_url') return INVALID_URL_MESSAGE;
  if (error?.code === 'unsupported_host' || error?.code === 'private_address') return DOMAIN_UNSUPPORTED_MESSAGE;
  return FETCH_ERROR_MESSAGE;
}

export function createDownloadHandler({
  queue = downloadQueue,
  downloader = downloadDirectVideo,
  allowedHosts,
  replyTimeoutMs = REPLY_TIMEOUT_MS,
  mediaSendTimeoutMs = MEDIA_SEND_TIMEOUT_MS,
} = {}) {
  return function downloadHandler(message, { sock, args, prefix }) {
    const input = args.join(' ').trim();
    if (!input) {
      replyWithoutBlocking(
        message,
        `Usage: *${prefix}download <URL>*\nHanya video MP4 langsung dari host yang diizinkan; unduh hanya konten yang kamu miliki atau berizin.`,
        replyTimeoutMs,
      );
      return;
    }

    const hostAllowlist = parseAllowedHosts(allowedHosts);
    let targetUrl;
    try {
      targetUrl = validateDownloadUrl(input, { allowedHosts: hostAllowlist });
    } catch (error) {
      const reply = hostAllowlist.size === 0 && error?.code === 'unsupported_host'
        ? FEATURE_DISABLED_MESSAGE
        : userFacingError(error);
      replyWithoutBlocking(message, reply, replyTimeoutMs);
      return;
    }

    const accepted = queue.add(async () => {
      const acknowledged = await safeReply(message, ACCEPTED_MESSAGE, replyTimeoutMs);
      if (!acknowledged) return;

      let media;
      try {
        media = await downloader(targetUrl.href, { allowedHosts: hostAllowlist });
      } catch (error) {
        await safeReply(message, userFacingError(error), replyTimeoutMs);
        return;
      }

      try {
        const content = {
          video: { url: media.filePath },
          mimetype: media.mimeType,
          caption: `✅ Siap! ${media.fileName}\nUnduh hanya video yang kamu miliki atau berizin.`,
        };
        const sendOptions = message.raw ? { quoted: message.raw } : {};
        await withTimeout(sock.sendMessage(message.chat, content, sendOptions), mediaSendTimeoutMs);
      } catch {
        await safeReply(message, SEND_ERROR_MESSAGE, replyTimeoutMs);
      } finally {
        try {
          await media.cleanup?.();
        } catch {
          console.warn('[download] Temporary media cleanup failed');
        }
      }
    });

    if (!accepted) replyWithoutBlocking(message, QUEUE_FULL_MESSAGE, replyTimeoutMs);
  };
}

const handler = createDownloadHandler();
handler.help = ['download <URL>'];
handler.tags = ['info'];
handler.command = /^download$/i;
handler.cooldown = 30;

export default handler;
