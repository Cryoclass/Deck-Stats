using System.Buffers.Binary;
using System.Globalization;
using System.Security.Cryptography;
using System.Text;

namespace Testhand.Admin.Security;

/// <summary>
/// TOTP (RFC 6238) sur HMAC-SHA1, pas de 30 secondes, 6 chiffres par défaut. Pur : l'horloge
/// et le dernier pas accepté sont fournis par l'appelant.
/// </summary>
public static class Totp
{
    /// <summary>Pas de temps par défaut, en secondes.</summary>
    public const int DefaultStep = 30;

    /// <summary>Nombre de chiffres par défaut.</summary>
    public const int DefaultDigits = 6;

    /// <summary>Numéro du pas de temps à l'instant donné (division entière vers le bas).</summary>
    public static long Counter(DateTimeOffset at, int step = DefaultStep)
    {
        ArgumentOutOfRangeException.ThrowIfLessThan(step, 1);
        long seconds = at.ToUnixTimeSeconds();
        long counter = seconds / step;
        if (seconds < 0 && seconds % step != 0) counter--;
        return counter;
    }

    /// <summary>Code HOTP (RFC 4226) du compteur donné, complété par des zéros à gauche.</summary>
    public static string Code(byte[] secret, long counter, int digits = DefaultDigits)
    {
        ArgumentNullException.ThrowIfNull(secret);
        ArgumentOutOfRangeException.ThrowIfLessThan(digits, 1);
        ArgumentOutOfRangeException.ThrowIfGreaterThan(digits, 9);

        Span<byte> message = stackalloc byte[8];
        BinaryPrimitives.WriteInt64BigEndian(message, counter);
        Span<byte> mac = stackalloc byte[HMACSHA1.HashSizeInBytes];
        HMACSHA1.HashData(secret, message, mac);

        // Troncature dynamique (RFC 4226 §5.3).
        int offset = mac[^1] & 0x0f;
        int binary = ((mac[offset] & 0x7f) << 24)
                   | (mac[offset + 1] << 16)
                   | (mac[offset + 2] << 8)
                   | mac[offset + 3];
        int modulo = (int)Math.Pow(10, digits);
        return (binary % modulo).ToString(CultureInfo.InvariantCulture).PadLeft(digits, '0');
    }

    /// <summary>
    /// Vérifie un code pour les pas <c>counterNow − window … counterNow + window</c>. Refuse tout
    /// pas inférieur ou égal à <paramref name="lastAcceptedCounter"/> (anti-rejeu), un code non
    /// numérique ou d'une autre longueur que <paramref name="digits"/>. Chaque candidat est
    /// comparé en temps constant. En cas de succès, <paramref name="acceptedCounter"/> reçoit le
    /// pas accepté, à conserver comme nouveau dernier pas ; sinon il vaut
    /// <paramref name="lastAcceptedCounter"/>.
    /// </summary>
    public static bool Verify(byte[] secret, string? code, long counterNow, long lastAcceptedCounter,
        out long acceptedCounter, int window = 1, int digits = DefaultDigits)
    {
        ArgumentNullException.ThrowIfNull(secret);
        ArgumentOutOfRangeException.ThrowIfNegative(window);
        acceptedCounter = lastAcceptedCounter;

        if (code is null || code.Length != digits) return false;
        foreach (char c in code)
            if (c is < '0' or > '9') return false;

        byte[] given = Encoding.ASCII.GetBytes(code);
        bool found = false;
        long foundCounter = lastAcceptedCounter;
        // Tous les candidats sont évalués, sans sortie anticipée.
        for (long counter = counterNow - window; counter <= counterNow + window; counter++)
        {
            byte[] expected = Encoding.ASCII.GetBytes(Code(secret, counter, digits));
            bool match = CryptographicOperations.FixedTimeEquals(expected, given);
            if (match && !found && counter > lastAcceptedCounter)
            {
                found = true;
                foundCounter = counter;
            }
        }

        if (found) acceptedCounter = foundCounter;
        return found;
    }
}
