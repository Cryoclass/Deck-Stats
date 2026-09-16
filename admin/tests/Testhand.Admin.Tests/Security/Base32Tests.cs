using System.Security.Cryptography;
using System.Text;
using Testhand.Admin.Security;

namespace Testhand.Admin.Tests.Security;

/// <summary>RFC 4648 §10 (remplissage retiré), aller-retour et tolérance du décodage.</summary>
public class Base32Tests
{
    [Theory]
    [InlineData("", "")]
    [InlineData("f", "MY")]
    [InlineData("fo", "MZXQ")]
    [InlineData("foo", "MZXW6")]
    [InlineData("foob", "MZXW6YQ")]
    [InlineData("fooba", "MZXW6YTB")]
    [InlineData("foobar", "MZXW6YTBOI")]
    public void Encode_VecteursRfc4648_Section10_SansRemplissage(string ascii, string expected)
    {
        Assert.Equal(expected, Base32.Encode(Encoding.ASCII.GetBytes(ascii)));
    }

    [Theory]
    [InlineData("", "")]
    [InlineData("MY", "f")]
    [InlineData("MY======", "f")]
    [InlineData("MZXQ====", "fo")]
    [InlineData("MZXW6===", "foo")]
    [InlineData("MZXW6YQ=", "foob")]
    [InlineData("MZXW6YTB", "fooba")]
    [InlineData("MZXW6YTBOI======", "foobar")]
    [InlineData("mzxw6ytboi", "foobar")]
    [InlineData("MZXW 6YTB OI", "foobar")]
    [InlineData("mzxw-6ytb-oi\n", "foobar")]
    public void Decode_TolereCasseEspacesTiretsEtRemplissage(string text, string expectedAscii)
    {
        Assert.Equal(Encoding.ASCII.GetBytes(expectedAscii), Base32.Decode(text));
    }

    [Theory]
    [InlineData("MZXW6YTB0I")]   // zéro
    [InlineData("MZXW6YTB1I")]   // un
    [InlineData("MZXW6Y=TB")]    // caractère après le remplissage
    [InlineData("MZXW6YTB!")]
    [InlineData("MZXW6YTBÉ")]
    public void Decode_RefuseLesCaracteresHorsAlphabet(string text)
    {
        Assert.Throws<FormatException>(() => Base32.Decode(text));
        Assert.False(Base32.TryDecode(text, out byte[] bytes));
        Assert.Empty(bytes);
    }

    [Fact]
    public void Decode_NullRefuseSansException_ParTryDecode()
    {
        Assert.False(Base32.TryDecode(null, out _));
        Assert.Throws<ArgumentNullException>(() => Base32.Decode(null!));
    }

    [Theory]
    [InlineData(0)]
    [InlineData(1)]
    [InlineData(4)]
    [InlineData(5)]
    [InlineData(19)]
    [InlineData(20)]
    [InlineData(33)]
    public void AllerRetour_LongueursVariees(int length)
    {
        for (int round = 0; round < 20; round++)
        {
            byte[] data = RandomNumberGenerator.GetBytes(length);
            string encoded = Base32.Encode(data);

            Assert.DoesNotContain('=', encoded);
            Assert.Equal((length * 8 + 4) / 5, encoded.Length);
            Assert.Equal(data, Base32.Decode(encoded));
        }
    }
}
