namespace Testhand.Admin.Security;

/// <summary>URI <c>otpauth://totp/…</c> pour l'enrôlement (QR et saisie manuelle).</summary>
public static class TotpUri
{
    /// <summary>
    /// <c>otpauth://totp/&lt;issuer&gt;:&lt;account&gt;?secret=&lt;base32&gt;&amp;issuer=&lt;issuer&gt;&amp;algorithm=SHA1&amp;digits=6&amp;period=30</c>,
    /// émetteur et compte échappés pour l'URL.
    /// </summary>
    public static string Build(string issuer, string account, byte[] secret)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(issuer);
        ArgumentException.ThrowIfNullOrWhiteSpace(account);
        ArgumentNullException.ThrowIfNull(secret);
        if (issuer.Contains(':')) throw new ArgumentException("L'émetteur ne peut pas contenir « : ».", nameof(issuer));

        string i = Uri.EscapeDataString(issuer);
        string a = Uri.EscapeDataString(account);
        return $"otpauth://totp/{i}:{a}?secret={Base32.Encode(secret)}&issuer={i}&algorithm=SHA1&digits={Totp.DefaultDigits}&period={Totp.DefaultStep}";
    }
}
