using System.Globalization;
using System.Security.Cryptography;
using System.Text;

namespace Testhand.Admin.Security;

/// <summary>
/// Lecture et vérification du format de <c>server/src/auth/password.ts</c> :
/// <c>scrypt:N:r:p:sel_base64:clé_base64</c>. Le site ne crée jamais de compte ; <see cref="Hash"/>
/// ne sert qu'au hachage factice et aux tests.
/// </summary>
public static class PasswordHash
{
    // Mêmes paramètres que le serveur Node (OWASP) : N = 2^17, r = 8, p = 1, 64 octets.
    private const int N = 1 << 17;
    private const int R = 8;
    private const int P = 1;
    private const int KeyLength = 64;
    private const int SaltLength = 16;

    /// <summary>
    /// Plafond mémoire accepté pour un hachage stocké (128·N·r), afin qu'une valeur hostile ne
    /// fasse pas exploser la mémoire : 512 Mio.
    /// </summary>
    public const long MaxMemoryBytes = Scrypt.DefaultMaxMemoryBytes;

    private static readonly Lazy<string> DummyLazy = new(
        () => Hash(Convert.ToBase64String(RandomNumberGenerator.GetBytes(16))),
        LazyThreadSafetyMode.ExecutionAndPublication);

    /// <summary>
    /// Hachage valide d'un mot de passe aléatoire, calculé une fois par processus. Sert à
    /// vérifier « à vide », au même coût, quand le compte n'existe pas (pas d'énumération par le
    /// temps de réponse). À toucher au démarrage pour payer le calcul avant la première requête.
    /// </summary>
    public static string Dummy => DummyLazy.Value;

    /// <summary>Vérifie contre <see cref="Dummy"/> et renvoie toujours faux.</summary>
    public static bool VerifyDummy(string password)
    {
        Verify(password, Dummy);
        return false;
    }

    /// <summary>Produit un hachage au format du serveur (sel aléatoire de 16 octets).</summary>
    public static string Hash(string password)
    {
        ArgumentNullException.ThrowIfNull(password);
        byte[] salt = RandomNumberGenerator.GetBytes(SaltLength);
        byte[] key = Scrypt.DeriveKey(Encoding.UTF8.GetBytes(password), salt, N, R, P, KeyLength);
        return string.Create(CultureInfo.InvariantCulture,
            $"scrypt:{N}:{R}:{P}:{Convert.ToBase64String(salt)}:{Convert.ToBase64String(key)}");
    }

    /// <summary>
    /// Vrai si <paramref name="password"/> (UTF-8) correspond au hachage stocké. Tout format
    /// inattendu, paramètre invalide ou hachage trop gourmand renvoie faux, sans exception.
    /// Comparaison en temps constant.
    /// </summary>
    public static bool Verify(string password, string? stored)
    {
        ArgumentNullException.ThrowIfNull(password);
        if (stored is null) return false;

        string[] parts = stored.Split(':');
        if (parts.Length != 6 || parts[0] != "scrypt") return false;
        if (!TryParseInt(parts[1], out int n) || !TryParseInt(parts[2], out int r) || !TryParseInt(parts[3], out int p))
            return false;
        if (!TryFromBase64(parts[4], out byte[] salt) || !TryFromBase64(parts[5], out byte[] expected))
            return false;
        if (expected.Length == 0) return false;
        if (!Scrypt.IsValidParameters(n, r, p, expected.Length, MaxMemoryBytes)) return false;

        byte[] key = Scrypt.DeriveKey(Encoding.UTF8.GetBytes(password), salt, n, r, p, expected.Length, MaxMemoryBytes);
        return CryptographicOperations.FixedTimeEquals(key, expected);
    }

    // Chiffres décimaux seulement (pas de signe, d'espace ni d'exposant), sans dépendre de la culture.
    private static bool TryParseInt(string s, out int value) =>
        int.TryParse(s, NumberStyles.None, CultureInfo.InvariantCulture, out value);

    // Base64 strict : Convert.FromBase64String tolère les espaces, un hachage stocké n'en a jamais.
    private static bool TryFromBase64(string s, out byte[] bytes)
    {
        bytes = [];
        if (s.Length == 0) return true; // sel vide autorisé (Node l'accepte), clé vide refusée plus haut
        if (s.Any(char.IsWhiteSpace)) return false;
        try
        {
            bytes = Convert.FromBase64String(s);
            return true;
        }
        catch (FormatException)
        {
            return false;
        }
    }
}
