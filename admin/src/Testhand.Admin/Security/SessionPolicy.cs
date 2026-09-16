using System.Buffers.Text;
using System.Security.Cryptography;
using System.Text;

namespace Testhand.Admin.Security;

/// <summary>
/// Politique de session du back-office : durée absolue de 8 heures à partir de la création,
/// jamais prolongée (aucune fonction de glissement n'existe ici, à dessein). Le jeton n'est stocké
/// qu'en empreinte SHA-256.
/// </summary>
public static class SessionPolicy
{
    /// <summary>Durée de vie absolue d'une session.</summary>
    public static readonly TimeSpan Lifetime = TimeSpan.FromHours(8);

    /// <summary>Taille du jeton brut, en octets.</summary>
    public const int TokenBytes = 32;

    /// <summary>Instant d'expiration : création + 8 h, calculé une fois pour toutes.</summary>
    public static DateTimeOffset ExpiresAt(DateTimeOffset createdAt) => createdAt + Lifetime;

    /// <summary>Expirée dès que <paramref name="now"/> atteint <paramref name="expiresAt"/>.</summary>
    public static bool IsExpired(DateTimeOffset expiresAt, DateTimeOffset now) => now >= expiresAt;

    /// <summary>Nouveau jeton : 32 octets aléatoires en base64url sans remplissage (43 caractères).</summary>
    public static string NewToken() => Base64Url.EncodeToString(RandomNumberGenerator.GetBytes(TokenBytes));

    /// <summary>Empreinte SHA-256 du jeton (UTF-8), seule valeur écrite en base.</summary>
    public static byte[] TokenHash(string token)
    {
        ArgumentNullException.ThrowIfNull(token);
        return SHA256.HashData(Encoding.UTF8.GetBytes(token));
    }
}
