using System.Text.Json;
using Testhand.Admin.Security;

namespace Testhand.Admin.Tests.Security;

/// <summary>Format de server/src/auth/password.ts : compatibilité avec les hachages Node et refus des formats malformés.</summary>
public class PasswordHashTests
{
    private sealed record NodeVector(string Password, string Hash, bool Matches);

    private sealed record NodeFixture(string GeneratedBy, NodeVector[] Entries);

    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

    private static NodeFixture LoadFixture()
    {
        string path = Path.Combine(AppContext.BaseDirectory, "fixtures", "scrypt-node-vectors.json");
        var fixture = JsonSerializer.Deserialize<NodeFixture>(File.ReadAllText(path), JsonOptions);
        Assert.NotNull(fixture);
        return fixture;
    }

    public static TheoryData<int> FixtureIndexes()
    {
        var data = new TheoryData<int>();
        for (int i = 0; i < LoadFixture().Entries.Length; i++) data.Add(i);
        return data;
    }

    [Fact]
    public void Fixture_CouvreLesCasDemandes()
    {
        NodeFixture fixture = LoadFixture();
        NodeVector[] matching = fixture.Entries.Where(e => e.Matches).ToArray();

        Assert.Equal("server/src/auth/password.ts", fixture.GeneratedBy);
        Assert.True(matching.Length >= 6);
        Assert.True(fixture.Entries.Count(e => !e.Matches) >= 2);
        Assert.Contains(matching, e => e.Password.Contains(' '));
        Assert.Contains(matching, e => e.Password.Contains("été"));
        Assert.Contains(matching, e => e.Password.Any(char.IsSurrogate)); // emoji
        Assert.Contains(matching, e => e.Password.Length == 200);
        Assert.Contains(matching, e => e.Password.Length == 0);
        Assert.All(fixture.Entries, e => Assert.StartsWith("scrypt:131072:8:1:", e.Hash));
    }

    [Theory]
    [MemberData(nameof(FixtureIndexes))]
    public void Verify_LitLesHachagesProduitsParNode(int index)
    {
        NodeVector v = LoadFixture().Entries[index];

        Assert.Equal(v.Matches, PasswordHash.Verify(v.Password, v.Hash));
    }

    [Fact]
    public void Hash_ProduitLeFormatDuServeur_EtVerifieAllerRetour()
    {
        string stored = PasswordHash.Hash("été 🃏");
        string[] parts = stored.Split(':');

        Assert.Equal(6, parts.Length);
        Assert.Equal(["scrypt", "131072", "8", "1"], parts.Take(4));
        Assert.Equal(16, Convert.FromBase64String(parts[4]).Length);
        Assert.Equal(64, Convert.FromBase64String(parts[5]).Length);
        Assert.True(PasswordHash.Verify("été 🃏", stored));
        Assert.False(PasswordHash.Verify("été 🃏 ", stored));
        Assert.False(PasswordHash.Verify("", stored));
    }

    [Fact]
    public void Dummy_EstUnHachageValide_QuiNeCorrespondARien()
    {
        string dummy = PasswordHash.Dummy;

        Assert.StartsWith("scrypt:131072:8:1:", dummy);
        Assert.Same(dummy, PasswordHash.Dummy); // calculé une seule fois
        Assert.False(PasswordHash.Verify("", dummy));
        Assert.False(PasswordHash.VerifyDummy("n'importe quoi"));
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("scrypt:1:2")]                                              // trop court
    [InlineData("scrypt:16:1:1:c2VsCg==:a2V5:extra")]                       // trop long
    [InlineData("bcrypt:16:1:1:c2VsCg==:a2V5")]                             // préfixe inconnu
    [InlineData("scrypt:16:1:1:c2VsCg==:")]                                 // clé vide
    [InlineData("scrypt:16:1:1:c2VsCg==:%%%%")]                             // base64 invalide (clé)
    [InlineData("scrypt:16:1:1:!!:a2V5")]                                   // base64 invalide (sel)
    [InlineData("scrypt:16:1:1:c2Vs Cg==:a2V5")]                            // espace dans le base64
    [InlineData("scrypt:seize:1:1:c2VsCg==:a2V5")]                          // N non numérique
    [InlineData("scrypt:-16:1:1:c2VsCg==:a2V5")]                            // N négatif
    [InlineData("scrypt:1e3:1:1:c2VsCg==:a2V5")]                            // N en notation scientifique
    [InlineData("scrypt:1000:1:1:c2VsCg==:a2V5")]                           // N pas une puissance de deux
    [InlineData("scrypt:16:0:1:c2VsCg==:a2V5")]                             // r nul
    [InlineData("scrypt:16:1:0:c2VsCg==:a2V5")]                             // p nul
    [InlineData("scrypt:1048576:8:1:c2VsCg==:a2V5")]                        // 1 Gio : au-delà du plafond
    [InlineData("scrypt:1073741824:1073741824:1:c2VsCg==:a2V5")]            // hostile, débordement
    [InlineData("scrypt:99999999999999999999:8:1:c2VsCg==:a2V5")]           // N hors int
    public void Verify_RefuseSansException_LesFormatsMalformes(string? stored)
    {
        Assert.False(PasswordHash.Verify("password", stored));
    }

    [Fact]
    public void Verify_PetitsParametres_SelVideAccepte()
    {
        // Vecteur 1 de la RFC 7914 (P = "", S = "", N = 16, r = 1, p = 1) au format du serveur.
        string key = Convert.ToBase64String(Hex.Bytes(@"
            77d6576238657b203b19ca42c18a0497 f16b4844e3074ae8dfdffa3fede21442
            fcd0069ded0948f8326a753a0fc81f17 e8d3e0fb2e0d3628cf35e20c38d18906"));

        Assert.True(PasswordHash.Verify("", $"scrypt:16:1:1::{key}"));
        Assert.False(PasswordHash.Verify("x", $"scrypt:16:1:1::{key}"));
    }

    [Fact]
    public void Verify_LongueurDeCleStockeeRespectee()
    {
        // Clé tronquée à 32 octets : Verify dérive 32 octets, pas 64.
        string stored = PasswordHash.Hash("abc");
        string[] parts = stored.Split(':');
        byte[] key = Convert.FromBase64String(parts[5]);
        parts[5] = Convert.ToBase64String(key.AsSpan(0, 32));

        Assert.True(PasswordHash.Verify("abc", string.Join(':', parts)));
    }
}
