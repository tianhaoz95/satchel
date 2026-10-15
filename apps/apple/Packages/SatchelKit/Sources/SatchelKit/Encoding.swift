import CryptoKit
import Foundation

public enum Base64URL {
    public static func encode(_ data: Data) -> String {
        data.base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }

    public static func decode(_ string: String) -> Data? {
        var s = string.replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/")
        while s.count % 4 != 0 { s += "=" }
        return Data(base64Encoded: s)
    }
}

/// SubjectPublicKeyInfo headers, so a raw key from `SecKeyCopyExternalRepresentation` can be
/// turned into the SPKI DER the protocol and the TLS pin are defined over.
enum SPKIHeader {
    /// id-ecPublicKey + prime256v1, followed by the 65-byte uncompressed point.
    static let p256 = Data([0x30, 0x59, 0x30, 0x13, 0x06, 0x07, 0x2A, 0x86, 0x48, 0xCE, 0x3D, 0x02, 0x01, 0x06, 0x08, 0x2A, 0x86, 0x48, 0xCE, 0x3D, 0x03, 0x01, 0x07, 0x03, 0x42, 0x00])
    /// rsaEncryption, 2048-bit modulus (nodes created before v2 have RSA keys).
    static let rsa2048 = Data([0x30, 0x82, 0x01, 0x22, 0x30, 0x0D, 0x06, 0x09, 0x2A, 0x86, 0x48, 0x86, 0xF7, 0x0D, 0x01, 0x01, 0x01, 0x05, 0x00, 0x03, 0x82, 0x01, 0x0F, 0x00])
}

public enum Pin {
    /// Standard base64 SHA-256 of a key's SPKI DER (the value carried in the pairing link).
    public static func sha256(spki: Data) -> String {
        Data(SHA256.hash(data: spki)).base64EncodedString()
    }

    /// Pin of a server certificate's public key, or nil for key types the protocol doesn't use.
    public static func of(_ key: SecKey) -> String? {
        guard let raw = SecKeyCopyExternalRepresentation(key, nil) as Data?,
              let attrs = SecKeyCopyAttributes(key) as? [CFString: Any],
              let type = attrs[kSecAttrKeyType] as? String else { return nil }
        if type == (kSecAttrKeyTypeECSECPrimeRandom as String), raw.count == 65 {
            return sha256(spki: SPKIHeader.p256 + raw)
        }
        if type == (kSecAttrKeyTypeRSA as String), (attrs[kSecAttrKeySizeInBits] as? Int) == 2048 {
            return sha256(spki: SPKIHeader.rsa2048 + raw)
        }
        return nil
    }
}
