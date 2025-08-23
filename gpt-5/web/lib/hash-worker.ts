import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex } from "@noble/hashes/utils";

export function calculateFileHash(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = (event) => {
      try {
        const arrayBuffer = event.target?.result as ArrayBuffer;
        const uint8Array = new Uint8Array(arrayBuffer);
        const hash = bytesToHex(sha256(uint8Array));
        resolve(hash);
      } catch (error) {
        reject(error);
      }
    };

    reader.onerror = () => {
      reject(new Error("Failed to read file"));
    };

    reader.readAsArrayBuffer(file);
  });
}

// Alternative implementation using Web Crypto API for larger files
export async function calculateFileHashChunked(file: File): Promise<string> {
  const chunkSize = 1024 * 1024; // 1MB chunks
  const hashBuffer = new ArrayBuffer(32); // SHA-256 is 32 bytes
  const hashArray = new Uint8Array(hashBuffer);

  let offset = 0;

  while (offset < file.size) {
    const chunk = file.slice(offset, offset + chunkSize);
    const chunkBuffer = await chunk.arrayBuffer();
    const chunkArray = new Uint8Array(chunkBuffer);

    // For MVP, use simple concatenation
    // In production, use proper streaming hash
    const combined = new Uint8Array(hashArray.length + chunkArray.length);
    combined.set(hashArray);
    combined.set(chunkArray, hashArray.length);

    const newHash = sha256(combined);
    hashArray.set(newHash);

    offset += chunkSize;
  }

  return bytesToHex(hashArray);
}
