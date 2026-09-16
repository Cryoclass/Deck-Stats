using System.Security.Cryptography;

namespace Testhand.Admin.Security;

/// <summary>
/// Chiffrement AES-256-GCM d'un secret TOTP avec la clé <c>BACKOFFICE_TOTP_KEY</c> (32 octets en
/// base64). Format scellé : nonce (12) ‖ étiquette (16) ‖ chiffré.
/// </summary>
public sealed class SecretBox : IDisposable
{
    /// <summary>Longueur de clé attendue, en octets.</summary>
    public const int KeyLength = 32;

    /// <summary>Longueur du nonce, en octets.</summary>
    public const int NonceLength = 12;

    /// <summary>Longueur de l'étiquette d'authentification, en octets.</summary>
    public const int TagLength = 16;

    private readonly AesGcm _aes;

    /// <summary>
    /// Construit la boîte à partir de la clé en base64. Lève <see cref="ArgumentException"/> avec
    /// un message clair si la clé est absente, illisible ou d'une autre longueur que 32 octets.
    /// </summary>
    public SecretBox(string? base64Key)
    {
        if (string.IsNullOrWhiteSpace(base64Key))
            throw new ArgumentException("BACKOFFICE_TOTP_KEY est absente : attendu 32 octets aléatoires en base64.", nameof(base64Key));

        byte[] key;
        try
        {
            key = Convert.FromBase64String(base64Key.Trim());
        }
        catch (FormatException e)
        {
            throw new ArgumentException("BACKOFFICE_TOTP_KEY n'est pas du base64 valide.", nameof(base64Key), e);
        }

        if (key.Length != KeyLength)
        {
            CryptographicOperations.ZeroMemory(key);
            throw new ArgumentException(
                $"BACKOFFICE_TOTP_KEY doit faire {KeyLength} octets une fois décodée (reçu {key.Length}).", nameof(base64Key));
        }

        _aes = new AesGcm(key, TagLength);
        CryptographicOperations.ZeroMemory(key);
    }

    /// <summary>Scelle le clair : nonce aléatoire de 12 octets ‖ étiquette de 16 ‖ chiffré.</summary>
    public byte[] Seal(byte[] plain)
    {
        ArgumentNullException.ThrowIfNull(plain);
        byte[] result = new byte[NonceLength + TagLength + plain.Length];
        Span<byte> nonce = result.AsSpan(0, NonceLength);
        Span<byte> tag = result.AsSpan(NonceLength, TagLength);
        Span<byte> cipher = result.AsSpan(NonceLength + TagLength);
        RandomNumberGenerator.Fill(nonce);
        _aes.Encrypt(nonce, plain, cipher, tag);
        return result;
    }

    /// <summary>
    /// Ouvre une valeur scellée. Lève <see cref="CryptographicException"/> si elle est tronquée,
    /// altérée ou scellée avec une autre clé.
    /// </summary>
    public byte[] Open(byte[] sealedValue)
    {
        ArgumentNullException.ThrowIfNull(sealedValue);
        if (sealedValue.Length < NonceLength + TagLength)
            throw new CryptographicException("Valeur scellée trop courte.");
        ReadOnlySpan<byte> nonce = sealedValue.AsSpan(0, NonceLength);
        ReadOnlySpan<byte> tag = sealedValue.AsSpan(NonceLength, TagLength);
        ReadOnlySpan<byte> cipher = sealedValue.AsSpan(NonceLength + TagLength);
        byte[] plain = new byte[cipher.Length];
        _aes.Decrypt(nonce, cipher, tag, plain);
        return plain;
    }

    public void Dispose() => _aes.Dispose();
}
