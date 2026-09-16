using System.Buffers.Binary;
using System.Numerics;
using System.Security.Cryptography;

namespace Testhand.Admin.Security;

/// <summary>
/// scrypt (RFC 7914) sans dépendance : PBKDF2-HMAC-SHA256 natif, Salsa20/8, BlockMix, ROMix.
/// Pur, sans état ; les fonctions internes sont visibles du projet de tests pour les vecteurs
/// des §8, §9 et §10 de la RFC.
/// </summary>
public static class Scrypt
{
    /// <summary>Plafond mémoire par défaut de ROMix (128·N·r octets) : 512 Mio.</summary>
    public const long DefaultMaxMemoryBytes = 512L * 1024 * 1024;

    /// <summary>Mémoire de travail de ROMix pour des paramètres donnés, en octets (128·N·r).</summary>
    public static long MemoryBytes(int n, int r) => 128L * n * r;

    /// <summary>
    /// Vrai si les paramètres respectent la RFC (N puissance de deux &gt; 1, r &gt; 0, p &gt; 0,
    /// dkLen &gt; 0, N &lt; 2^(16·r)) et le plafond mémoire. Aucune exception.
    /// </summary>
    public static bool IsValidParameters(int n, int r, int p, int dkLen, long maxMemoryBytes = DefaultMaxMemoryBytes)
    {
        if (n < 2 || !BitOperations.IsPow2(n)) return false;
        if (r < 1 || p < 1 || dkLen < 1) return false;
        // N < 2^(128·r/8) ; seul r = 1 borne réellement N (2^16) dans la plage d'un int.
        if (r == 1 && n >= 1 << 16) return false;
        if (maxMemoryBytes < 128) return false;
        // Comparaisons par division : 128·N·r et 128·p·r peuvent déborder un long avec des
        // valeurs hostiles (N et r proches de 2^31).
        long perBlock = maxMemoryBytes / 128;
        if ((long)n * r > perBlock) return false;
        // Le tampon B (p blocs de 128·r octets) doit rester adressable et raisonnable.
        if ((long)p * r > perBlock) return false;
        return true;
    }

    /// <summary>
    /// Dérive <paramref name="dkLen"/> octets du mot de passe et du sel (RFC 7914 §6).
    /// Lève <see cref="ArgumentException"/> pour des paramètres invalides ou trop gourmands.
    /// </summary>
    public static byte[] DeriveKey(byte[] password, byte[] salt, int n, int r, int p, int dkLen,
        long maxMemoryBytes = DefaultMaxMemoryBytes)
    {
        ArgumentNullException.ThrowIfNull(password);
        ArgumentNullException.ThrowIfNull(salt);
        if (!IsValidParameters(n, r, p, dkLen, maxMemoryBytes))
            throw new ArgumentException("Paramètres scrypt invalides ou au-delà du plafond mémoire.");

        int blockWords = 32 * r;   // mots de 32 bits par bloc B_i (128·r octets)
        int blockBytes = 128 * r;

        // 1. B = PBKDF2-HMAC-SHA256(P, S, 1, p · 128 · r)
        byte[] b = Rfc2898DeriveBytes.Pbkdf2(password, salt, 1, HashAlgorithmName.SHA256, p * blockBytes);

        // Mots en petit-boutien, conversion faite une seule fois hors des boucles chaudes.
        uint[] words = new uint[p * blockWords];
        for (int i = 0; i < words.Length; i++)
            words[i] = BinaryPrimitives.ReadUInt32LittleEndian(b.AsSpan(i * 4, 4));

        // 2. ROMix sur chaque bloc, avec un seul tampon V réutilisé (128·N·r octets).
        uint[] v = new uint[checked(n * blockWords)];
        uint[] x = new uint[blockWords];
        uint[] y = new uint[blockWords];
        uint[] tmp = new uint[16];
        for (int i = 0; i < p; i++)
            ROMix(words.AsSpan(i * blockWords, blockWords), v, x, y, tmp, n, r);

        for (int i = 0; i < words.Length; i++)
            BinaryPrimitives.WriteUInt32LittleEndian(b.AsSpan(i * 4, 4), words[i]);

        // 3. DK = PBKDF2-HMAC-SHA256(P, B, 1, dkLen)
        byte[] dk = Rfc2898DeriveBytes.Pbkdf2(password, b, 1, HashAlgorithmName.SHA256, dkLen);
        CryptographicOperations.ZeroMemory(b);
        Array.Clear(words);
        return dk;
    }

    /// <summary>
    /// ROMix (RFC 7914 §5) sur un bloc de 32·r mots, en place. <paramref name="v"/> contient au
    /// moins N·32·r mots ; <paramref name="x"/> et <paramref name="y"/> sont deux tampons de 32·r mots,
    /// <paramref name="tmp"/> un tampon de 16 mots. Aucune allocation.
    /// </summary>
    internal static void ROMix(Span<uint> block, uint[] v, uint[] x, uint[] y, uint[] tmp, int n, int r)
    {
        int len = 32 * r;
        int lastBlockStart = (2 * r - 1) * 16;
        uint mask = (uint)(n - 1);
        Span<uint> cur = x;
        Span<uint> next = y;
        block.CopyTo(cur);

        for (int i = 0; i < n; i++)
        {
            cur.CopyTo(v.AsSpan(i * len, len));
            BlockMix(cur, next, tmp, r);
            Span<uint> t = cur; cur = next; next = t;
        }

        for (int i = 0; i < n; i++)
        {
            // Integerify : premier mot du dernier bloc de 64 octets, modulo N.
            int j = (int)(cur[lastBlockStart] & mask);
            ReadOnlySpan<uint> vj = v.AsSpan(j * len, len);
            for (int k = 0; k < len; k++) cur[k] ^= vj[k];
            BlockMix(cur, next, tmp, r);
            Span<uint> t = cur; cur = next; next = t;
        }

        cur.CopyTo(block);
    }

    /// <summary>
    /// BlockMix (RFC 7914 §4) : 2·r blocs de 16 mots en entrée, sortie dans un tampon distinct
    /// (blocs pairs d'abord, puis impairs). <paramref name="x"/> est un tampon de 16 mots.
    /// </summary>
    internal static void BlockMix(ReadOnlySpan<uint> input, Span<uint> output, Span<uint> x, int r)
    {
        int count = 2 * r;
        input.Slice((count - 1) * 16, 16).CopyTo(x);
        for (int i = 0; i < count; i++)
        {
            ReadOnlySpan<uint> bi = input.Slice(i * 16, 16);
            for (int k = 0; k < 16; k++) x[k] ^= bi[k];
            Salsa20Core8(x);
            int dest = (i & 1) == 0 ? (i >> 1) * 16 : (r + (i >> 1)) * 16;
            x.CopyTo(output.Slice(dest, 16));
        }
    }

    /// <summary>Salsa20/8 core (RFC 7914 §3) sur 16 mots, en place.</summary>
    internal static void Salsa20Core8(Span<uint> b)
    {
        uint x0 = b[0], x1 = b[1], x2 = b[2], x3 = b[3];
        uint x4 = b[4], x5 = b[5], x6 = b[6], x7 = b[7];
        uint x8 = b[8], x9 = b[9], x10 = b[10], x11 = b[11];
        uint x12 = b[12], x13 = b[13], x14 = b[14], x15 = b[15];

        for (int i = 0; i < 8; i += 2)
        {
            // Tour sur les colonnes.
            x4 ^= BitOperations.RotateLeft(x0 + x12, 7);
            x8 ^= BitOperations.RotateLeft(x4 + x0, 9);
            x12 ^= BitOperations.RotateLeft(x8 + x4, 13);
            x0 ^= BitOperations.RotateLeft(x12 + x8, 18);
            x9 ^= BitOperations.RotateLeft(x5 + x1, 7);
            x13 ^= BitOperations.RotateLeft(x9 + x5, 9);
            x1 ^= BitOperations.RotateLeft(x13 + x9, 13);
            x5 ^= BitOperations.RotateLeft(x1 + x13, 18);
            x14 ^= BitOperations.RotateLeft(x10 + x6, 7);
            x2 ^= BitOperations.RotateLeft(x14 + x10, 9);
            x6 ^= BitOperations.RotateLeft(x2 + x14, 13);
            x10 ^= BitOperations.RotateLeft(x6 + x2, 18);
            x3 ^= BitOperations.RotateLeft(x15 + x11, 7);
            x7 ^= BitOperations.RotateLeft(x3 + x15, 9);
            x11 ^= BitOperations.RotateLeft(x7 + x3, 13);
            x15 ^= BitOperations.RotateLeft(x11 + x7, 18);

            // Tour sur les lignes.
            x1 ^= BitOperations.RotateLeft(x0 + x3, 7);
            x2 ^= BitOperations.RotateLeft(x1 + x0, 9);
            x3 ^= BitOperations.RotateLeft(x2 + x1, 13);
            x0 ^= BitOperations.RotateLeft(x3 + x2, 18);
            x6 ^= BitOperations.RotateLeft(x5 + x4, 7);
            x7 ^= BitOperations.RotateLeft(x6 + x5, 9);
            x4 ^= BitOperations.RotateLeft(x7 + x6, 13);
            x5 ^= BitOperations.RotateLeft(x4 + x7, 18);
            x11 ^= BitOperations.RotateLeft(x10 + x9, 7);
            x8 ^= BitOperations.RotateLeft(x11 + x10, 9);
            x9 ^= BitOperations.RotateLeft(x8 + x11, 13);
            x10 ^= BitOperations.RotateLeft(x9 + x8, 18);
            x12 ^= BitOperations.RotateLeft(x15 + x14, 7);
            x13 ^= BitOperations.RotateLeft(x12 + x15, 9);
            x14 ^= BitOperations.RotateLeft(x13 + x12, 13);
            x15 ^= BitOperations.RotateLeft(x14 + x13, 18);
        }

        b[0] += x0; b[1] += x1; b[2] += x2; b[3] += x3;
        b[4] += x4; b[5] += x5; b[6] += x6; b[7] += x7;
        b[8] += x8; b[9] += x9; b[10] += x10; b[11] += x11;
        b[12] += x12; b[13] += x13; b[14] += x14; b[15] += x15;
    }
}
