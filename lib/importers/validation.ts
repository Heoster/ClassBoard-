const MAX_FILE_BYTES = 50 * 1024 * 1024;
const supported = ["pdf"];
export function validateUpload(file: File): void {
    const extension = file.name.split(".").at(-1)?.toLowerCase();
    if (!extension || !supported.includes(extension) || (file.type && file.type !== "application/pdf")) throw new Error("Choose a PDF file.");
    if (file.size === 0) throw new Error("That file is empty.");
    if (file.size > MAX_FILE_BYTES) throw new Error("Files must be 50 MB or smaller.");
}
