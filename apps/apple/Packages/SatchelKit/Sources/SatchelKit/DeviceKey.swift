import CryptoKit
import Foundation
import LocalAuthentication
import Security

/// The device's P-256 signing key. On real hardware it lives in the Secure Enclave and every
/// signature requires biometrics (iPhone) or an unlocked, on-wrist watch. Simulators and tests use
/// a software key and report `isHardware == false` to the node.
public final class DeviceKey: @unchecked Sendable {
    public enum KeyError: LocalizedError {
        case notFound, cancelled, failed(String)
        public var errorDescription: String? {
            switch self {
            case .notFound: "No device key"
            case .cancelled: "Authentication was cancelled"
            case let .failed(m): m
            }
        }
    }

    private enum Backing {
        /// Stored as the enclave's wrapped blob so each signature can carry its own Face ID reason.
        case enclave(SecureEnclave.P256.Signing.PrivateKey, blob: Data)
        case software(P256.Signing.PrivateKey)
    }

    private let backing: Backing
    public let isHardware: Bool

    private init(_ backing: Backing) {
        self.backing = backing
        if case .enclave = backing { isHardware = true } else { isHardware = false }
    }

    /// SPKI DER, base64url: the form the node stores.
    public var publicKey: String {
        switch backing {
        case let .enclave(k, _): Base64URL.encode(k.publicKey.derRepresentation)
        case let .software(k): Base64URL.encode(k.publicKey.derRepresentation)
        }
    }

    public var fingerprint: String {
        String(Base64URL.encode(Data(SHA256.hash(data: Base64URL.decode(publicKey) ?? Data()))).prefix(16))
    }

    /// Signs `message` (UTF-8). In the Secure Enclave case the system shows Face ID / Touch ID with
    /// `reason`; the key can't be used without it.
    public func sign(_ message: String, reason: String) throws -> String {
        let data = Data(message.utf8)
        switch backing {
        case let .enclave(_, blob):
            let context = LAContext()
            #if !os(watchOS)
                context.localizedReason = reason
            #endif
            do {
                let k = try SecureEnclave.P256.Signing.PrivateKey(dataRepresentation: blob, authenticationContext: context)
                return Base64URL.encode(try k.signature(for: data).derRepresentation)
            } catch let e as LAError where e.code == .userCancel || e.code == .appCancel || e.code == .systemCancel {
                throw KeyError.cancelled
            } catch {
                throw KeyError.failed(error.localizedDescription)
            }
        case let .software(k):
            return Base64URL.encode(try k.signature(for: data).derRepresentation)
        }
    }

    /// Creates a new key, preferring the Secure Enclave. `requireBiometrics` is false on the watch,
    /// where an unlocked, on-wrist watch is the user-presence check.
    public static func create(label: String, requireBiometrics: Bool, context: LAContext? = nil) throws -> DeviceKey {
        if SecureEnclave.isAvailable {
            var flags: SecAccessControlCreateFlags = [.privateKeyUsage]
            if requireBiometrics { flags.insert(.biometryCurrentSet) }
            var error: Unmanaged<CFError>?
            guard let access = SecAccessControlCreateWithFlags(nil, kSecAttrAccessibleWhenUnlockedThisDeviceOnly, flags, &error) else {
                throw KeyError.failed("Access control: \(error!.takeRetainedValue())")
            }
            let key = try SecureEnclave.P256.Signing.PrivateKey(accessControl: access, authenticationContext: context)
            try Keychain.set(key.dataRepresentation, account: "key.\(label)", kind: "enclave")
            return DeviceKey(.enclave(key, blob: key.dataRepresentation))
        }
        let key = P256.Signing.PrivateKey()
        try Keychain.set(key.rawRepresentation, account: "key.\(label)", kind: "software")
        return DeviceKey(.software(key))
    }

    public static func load(label: String) -> DeviceKey? {
        guard let (data, kind) = Keychain.get(account: "key.\(label)") else { return nil }
        if kind == "enclave", let k = try? SecureEnclave.P256.Signing.PrivateKey(dataRepresentation: data, authenticationContext: nil) {
            return DeviceKey(.enclave(k, blob: data))
        }
        if kind == "software", let k = try? P256.Signing.PrivateKey(rawRepresentation: data) {
            return DeviceKey(.software(k))
        }
        return nil
    }

    /// For tests and the conformance vectors: a key from known raw bytes.
    public static func software(raw: Data) throws -> DeviceKey {
        DeviceKey(.software(try P256.Signing.PrivateKey(rawRepresentation: raw)))
    }

    public static func delete(label: String) {
        Keychain.delete(account: "key.\(label)")
    }
}
