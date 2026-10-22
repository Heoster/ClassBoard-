import type { ImportedDocument, PresentationImporter } from "./types";
import { validateUpload } from "./validation";
const pdf: PresentationImporter = {
    supports: file => file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf"),
    import: async file => ({ name: file.name, mimeType: "application/pdf", data: await file.arrayBuffer(), sourceType: "pdf" }),
};
export const importers = [pdf];
export async function importDocument(file: File): Promise<ImportedDocument> {
    validateUpload(file);
    const importer = importers.find(item => item.supports(file));
    if (!importer) throw new Error("Choose a PDF file.");
    return importer.import(file);
}
