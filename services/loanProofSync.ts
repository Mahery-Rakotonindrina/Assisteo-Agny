import { loanProofs, proofPaths, proofsToUpload, thumbnailPath } from "@/lib/loanProof";
import { supabase } from "@/lib/supabase";
import { isSavingData } from "./dataSaver";
import { loanProofStore } from "./loanProofStore";
import { loanStore } from "./loanStore";

// "Prêts": the photo proofs in the account, like the scans' photos
// (services/sync.ts): the private "scans" bucket, under
// <user id>/loans/<loan id>/<proof id>.jpg and .thumb.jpg. The loans
// themselves travel in their table (services/loanSync.ts), each with its list
// of proofs and where their photos are.

const BUCKET = "scans";
/** A photo just added is never taken for a leftover. */
const LEFTOVER_AFTER_MS = 10 * 60 * 1000;

/** A data URL as a Blob, decoded here: on the web, the CSP keeps fetch() off data: URLs. */
async function dataUrlToBlob(dataUrl: string) {
  const comma = dataUrl.indexOf(",");
  const head = dataUrl.slice(0, comma);
  const type = /^data:([^;,]+)/.exec(head)?.[1] ?? "application/octet-stream";
  const data = dataUrl.slice(comma + 1);
  if (!head.includes(";base64")) return new Blob([decodeURIComponent(data)], { type });
  const binary = atob(data);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return new Blob([bytes], { type });
}

async function blobToDataUrl(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

/** The account's files of removed proofs and loans. */
async function pushRemovals(uid: string) {
  const pending = await loanProofStore.pendingRemovals();
  // Another account's files (signed out since): not ours to remove any more.
  const others = pending.filter((path) => !path.startsWith(`${uid}/`));
  if (others.length > 0) await loanProofStore.clearRemovals(others);
  const own = pending.filter((path) => path.startsWith(`${uid}/`));
  if (own.length === 0) return;
  const { error } = await supabase().storage.from(BUCKET).remove(own);
  if (error) throw error;
  await loanProofStore.clearRemovals(own);
}

/** The photos taken on this device, not in the account yet. */
async function pushPhotos(uid: string) {
  for (const loan of await loanStore.list()) {
    for (const proof of proofsToUpload(loan)) {
      const image = await loanProofStore.get(proof.id);
      if (!image) continue;
      const paths = proofPaths(uid, loan.id, proof.id);
      const uploads = await Promise.all([
        supabase().storage.from(BUCKET).upload(paths.preview, await dataUrlToBlob(image.preview), { contentType: "image/jpeg", upsert: true }),
        supabase().storage.from(BUCKET).upload(paths.thumbnail, await dataUrlToBlob(image.thumbnail), { contentType: "image/jpeg", upsert: true }),
      ]);
      const failed = uploads.find((upload) => upload.error);
      if (failed?.error) throw failed.error;
      // The loan now says where its photo is: pushed with it by the loans' sync.
      await loanStore.setProofRemote(loan.id, proof.id, paths.preview);
    }
  }
}

/** The photos added on another device; the data saver only takes the thumbnail. */
async function pullPhotos() {
  const loans = await loanStore.list();
  for (const loan of loans) {
    for (const proof of loanProofs(loan)) {
      if (proof.kind !== "photo" || !proof.remote || (await loanProofStore.get(proof.id))) continue;
      const light = isSavingData();
      const paths = light ? [thumbnailPath(proof.remote)] : [proof.remote, thumbnailPath(proof.remote)];
      const { data, error } = await supabase().storage.from(BUCKET).createSignedUrls(paths, 120);
      if (error || !data) continue;
      const [preview, thumbnail = preview] = await Promise.all(data.map(async (item) => (item.signedUrl ? blobToDataUrl(await (await fetch(item.signedUrl)).blob()) : null)));
      if (!preview || !thumbnail) continue;
      await loanProofStore.put({ id: proof.id, loanId: loan.id, preview, thumbnail, addedAt: proof.addedAt });
    }
  }
  // Images of proofs removed on another device.
  const live = new Set(loans.flatMap((loan) => loanProofs(loan).map((proof) => proof.id)));
  const now = Date.now();
  for (const image of await loanProofStore.raw()) {
    if (!live.has(image.id) && now - image.addedAt > LEFTOVER_AFTER_MS) await loanProofStore.remove(image.id);
  }
  loanProofStore.notify();
}

let running: Promise<void> | null = null;

/** Removals, then this device's photos, then the others'. */
export function syncLoanProofs(uid: string) {
  running ??= (async () => {
    await pushRemovals(uid);
    await pushPhotos(uid);
    await pullPhotos();
  })().finally(() => {
    running = null;
  });
  return running;
}
