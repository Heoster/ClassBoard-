"use client";
import QRCode from "qrcode";
import { useEffect, useState } from "react";

/** This QR opens the approved phone sign-in page; desktop pairing awaits a server-issued single-use session. */
export function PhoneQr() {
    const [image, setImage] = useState<string>();
    useEffect(() => {
        QRCode.toDataURL(`${window.location.origin}/sign-in`, { width: 220, margin: 1, color: { dark: "#172033", light: "#ffffff" } })
            .then(setImage)
            .catch(() => setImage(undefined));
    }, []);
    return image ? (
        <img className="phone-qr" src={image} alt="QR code that opens the MAPLES ACADEMY SMARTBOARD TOOL sign-in page on a phone" />
    ) : (
        <p>Preparing QR code…</p>
    );
}
