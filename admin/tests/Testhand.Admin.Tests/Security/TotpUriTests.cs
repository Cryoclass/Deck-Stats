using System.Text;
using Testhand.Admin.Security;

namespace Testhand.Admin.Tests.Security;

public class TotpUriTests
{
    [Fact]
    public void Build_FormatAttendu()
    {
        byte[] secret = Encoding.ASCII.GetBytes("12345678901234567890");

        string uri = TotpUri.Build("Testhand", "admin@example.test", secret);

        Assert.Equal(
            "otpauth://totp/Testhand:admin%40example.test?secret=GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ&issuer=Testhand&algorithm=SHA1&digits=6&period=30",
            uri);
    }

    [Fact]
    public void Build_EchappeEmetteurEtCompte()
    {
        string uri = TotpUri.Build("Testhand admin", "célian&co@example.test", [1, 2, 3]);

        Assert.StartsWith("otpauth://totp/Testhand%20admin:c%C3%A9lian%26co%40example.test?secret=AEBAG&issuer=Testhand%20admin&", uri);
        Assert.EndsWith("&algorithm=SHA1&digits=6&period=30", uri);
        Assert.True(Uri.TryCreate(uri, UriKind.Absolute, out Uri? parsed));
        Assert.Equal("otpauth", parsed!.Scheme);
    }

    [Fact]
    public void Build_SecretRelisibleDepuisLUri()
    {
        byte[] secret = [0xde, 0xad, 0xbe, 0xef, 0x00, 0x01, 0x02, 0x03, 0x04, 0x05];

        string uri = TotpUri.Build("Testhand", "a@b", secret);
        string encoded = uri.Split("secret=")[1].Split('&')[0];

        Assert.Equal(secret, Base32.Decode(encoded));
    }

    [Theory]
    [InlineData("", "a@b")]
    [InlineData(" ", "a@b")]
    [InlineData("Testhand", "")]
    [InlineData("Test:hand", "a@b")]
    public void Build_RefuseEmetteurOuCompteInvalide(string issuer, string account)
    {
        Assert.Throws<ArgumentException>(() => TotpUri.Build(issuer, account, [1]));
    }
}
