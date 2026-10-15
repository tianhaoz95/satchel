import Foundation
import Security

/// Small generic-password wrapper. Items are this-device-only and readable only while unlocked.
/// The app and its share extension share items through the keychain access group in
/// `Info.plist` (`SatchelKeychainGroup`) when the build is signed with that entitlement.
public enum Keychain {
    static let service = "dev.satchel.companion"

    static var accessGroup: String? {
        Bundle.main.object(forInfoDictionaryKey: "SatchelKeychainGroup") as? String
    }

    private static func base(_ account: String) -> [CFString: Any] {
        var q: [CFString: Any] = [kSecClass: kSecClassGenericPassword, kSecAttrService: service, kSecAttrAccount: account]
        if let group = accessGroup, !group.isEmpty, !group.contains("$(") { q[kSecAttrAccessGroup] = group }
        return q
    }

    public static func set(_ data: Data, account: String, kind: String = "") throws {
        delete(account: account)
        var q = base(account)
        q[kSecValueData] = data
        q[kSecAttrLabel] = kind
        q[kSecAttrAccessible] = kSecAttrAccessibleWhenUnlockedThisDeviceOnly
        var status = SecItemAdd(q as CFDictionary, nil)
        if status == errSecMissingEntitlement, q[kSecAttrAccessGroup] != nil {
            // Unsigned (simulator/CI) builds have no access-group entitlement.
            q.removeValue(forKey: kSecAttrAccessGroup)
            status = SecItemAdd(q as CFDictionary, nil)
        }
        guard status == errSecSuccess else { throw NSError(domain: NSOSStatusErrorDomain, code: Int(status)) }
    }

    public static func get(account: String) -> (Data, String)? {
        for withGroup in [true, false] {
            var q = base(account)
            if !withGroup { q.removeValue(forKey: kSecAttrAccessGroup) }
            q[kSecReturnData] = true
            q[kSecReturnAttributes] = true
            var out: CFTypeRef?
            if SecItemCopyMatching(q as CFDictionary, &out) == errSecSuccess, let item = out as? [CFString: Any], let data = item[kSecValueData] as? Data {
                return (data, item[kSecAttrLabel] as? String ?? "")
            }
        }
        return nil
    }

    public static func delete(account: String) {
        SecItemDelete(base(account) as CFDictionary)
        var q = base(account)
        q.removeValue(forKey: kSecAttrAccessGroup)
        SecItemDelete(q as CFDictionary)
    }
}
