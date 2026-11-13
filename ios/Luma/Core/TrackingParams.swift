import Foundation

/// Query parameters that only exist to follow people across sites (click IDs
/// of ad networks, newsletter tracking, campaign tags). They are removed
/// before a page loads. Ported from the desktop app (`src/shared/security.ts`).
enum TrackingParams {
    private static let names: Set<String> = [
        "fbclid", "gclid", "gclsrc", "dclid", "gbraid", "wbraid", "msclkid", "yclid", "twclid", "ttclid",
        "igshid", "li_fat_id", "epik", "mc_eid", "_hsenc", "_hsmi", "__hssc", "__hstc", "__hsfp",
        "hsctatracking", "oly_anon_id", "oly_enc_id", "rb_clickid", "s_cid", "vero_id", "vero_conv",
        "wickedid", "ml_subscriber", "ml_subscriber_hash", "mkt_tok", "_openstat", "srsltid", "si",
    ]

    private static let prefixes = ["utm_", "pk_", "mtm_"]

    /// Sites where "si" is a share-tracking ID; elsewhere it may mean anything.
    private static let shareIDSites = ["youtube.com", "youtu.be", "spotify.com"]

    static func isTrackingParam(_ name: String, host: String) -> Bool {
        let n = name.lowercased()
        if n == "si" {
            return shareIDSites.contains(where: { host == $0 || host.hasSuffix("." + $0) })
        }
        return names.contains(n) || prefixes.contains(where: { n.hasPrefix($0) })
    }

    /// The URL without tracking parameters, or nil when nothing was removed.
    static func strip(from url: URL) -> URL? {
        guard let scheme = url.scheme?.lowercased(), scheme == "https" || scheme == "http" else { return nil }
        guard var comps = URLComponents(url: url, resolvingAgainstBaseURL: false) else { return nil }
        guard let query = comps.percentEncodedQuery, !query.isEmpty else { return nil }
        let host = (comps.host ?? "").lowercased()

        let parts = query.split(separator: "&", omittingEmptySubsequences: false)
        var kept: [Substring] = []
        var removed = false
        for part in parts {
            let rawName: Substring
            if let eq = part.firstIndex(of: "=") {
                rawName = part[..<eq]
            } else {
                rawName = part
            }
            let plusDecoded = rawName.replacingOccurrences(of: "+", with: " ")
            let name = plusDecoded.removingPercentEncoding ?? plusDecoded
            if !name.isEmpty && isTrackingParam(name, host: host) {
                removed = true
            } else {
                kept.append(part)
            }
        }
        guard removed else { return nil }

        let remaining = kept.filter { !$0.isEmpty }
        // Only pieces of the already valid encoded query are put back.
        comps.percentEncodedQuery = remaining.isEmpty ? nil : remaining.joined(separator: "&")
        return comps.url
    }
}
