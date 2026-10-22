export type ImportedDocument = { name: string; mimeType: "application/pdf"; data: ArrayBuffer; sourceType: "pdf" };
export interface PresentationImporter {
    supports(file: File): boolean;
    import(file: File): Promise<ImportedDocument>;
}
