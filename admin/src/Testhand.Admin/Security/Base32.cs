using System.Text;

namespace Testhand.Admin.Security;

/// <summary>Base32 (RFC 4648 §6) sans remplissage, pour l'URI otpauth et l'affichage du secret.</summary>
public static class Base32
{
    private const string Alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

    /// <summary>Encode sans caractère « = » de remplissage.</summary>
    public static string Encode(ReadOnlySpan<byte> data)
    {
        if (data.IsEmpty) return string.Empty;
        var sb = new StringBuilder((data.Length * 8 + 4) / 5);
        int buffer = 0;
        int bits = 0;
        foreach (byte b in data)
        {
            buffer = ((buffer << 8) | b) & 0xffff;
            bits += 8;
            while (bits >= 5)
            {
                bits -= 5;
                sb.Append(Alphabet[(buffer >> bits) & 0x1f]);
            }
        }
        if (bits > 0) sb.Append(Alphabet[(buffer << (5 - bits)) & 0x1f]);
        return sb.ToString();
    }

    /// <summary>
    /// Décode en tolérant la casse, les espaces, les tirets et un remplissage « = » final.
    /// Lève <see cref="FormatException"/> pour tout autre caractère.
    /// </summary>
    public static byte[] Decode(string text)
    {
        ArgumentNullException.ThrowIfNull(text);
        return TryDecode(text, out byte[] bytes)
            ? bytes
            : throw new FormatException("Chaîne base32 invalide.");
    }

    /// <summary>Variante sans exception de <see cref="Decode"/>.</summary>
    public static bool TryDecode(string? text, out byte[] bytes)
    {
        bytes = [];
        if (text is null) return false;

        var output = new List<byte>(text.Length * 5 / 8 + 1);
        int buffer = 0;
        int bits = 0;
        bool paddingSeen = false;
        foreach (char raw in text)
        {
            if (char.IsWhiteSpace(raw) || raw == '-') continue;
            if (raw == '=')
            {
                paddingSeen = true;
                continue;
            }
            if (paddingSeen) return false; // caractère utile après le remplissage
            int value = Alphabet.IndexOf(char.ToUpperInvariant(raw));
            if (value < 0) return false;
            buffer = ((buffer << 5) | value) & 0xffff;
            bits += 5;
            if (bits >= 8)
            {
                bits -= 8;
                output.Add((byte)((buffer >> bits) & 0xff));
            }
        }
        // Les bits restants (< 8) sont le complément d'un groupe incomplet : ignorés.
        bytes = output.ToArray();
        return true;
    }
}
