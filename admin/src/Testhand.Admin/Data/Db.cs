using Npgsql;

namespace Testhand.Admin.Data;

/// <summary>Source de connexions Npgsql à partir d'une URL <c>postgres://user:mdp@hôte:port/base</c>
/// (même forme que DATABASE_URL du serveur Node). Une seule source pour tout le site ; le rôle
/// est celui de l'URL — testhand_backoffice en production (T2, T3).</summary>
public static partial class Db
{
    [System.Text.RegularExpressions.GeneratedRegex(@"^postgres(?:ql)?://(?<user>[^:@/]+)(?::(?<pw>[^@]*))?@(?<host>[^:/@]+)(?::(?<port>\d{1,5}))?/(?<db>[^?#]+)$")]
    private static partial System.Text.RegularExpressions.Regex UrlRegex();

    public static NpgsqlDataSource CreateDataSource(string url)
    {
        // Analyse à la main et non par Uri : un mot de passe généré (base64, avec « / » ou « = »)
        // doit passer tel quel ; seul « @ » lui est interdit (il faudrait alors l'encoder en %40).
        var m = UrlRegex().Match(url);
        if (!m.Success) throw new InvalidOperationException("BACKOFFICE_DATABASE_URL : postgres://utilisateur:motdepasse@hôte[:port]/base attendue.");
        var b = new NpgsqlConnectionStringBuilder
        {
            Host = m.Groups["host"].Value,
            Port = m.Groups["port"].Success ? int.Parse(m.Groups["port"].Value) : 5432,
            Database = Uri.UnescapeDataString(m.Groups["db"].Value),
            Username = Uri.UnescapeDataString(m.Groups["user"].Value),
            Password = m.Groups["pw"].Success ? Uri.UnescapeDataString(m.Groups["pw"].Value) : "",
            ApplicationName = "testhand-backoffice",
            MaxPoolSize = 8,
            Timeout = 10,
            CommandTimeout = 15,
        };
        return NpgsqlDataSource.Create(b.ConnectionString);
    }

    public static NpgsqlCommand Cmd(this NpgsqlDataSource ds, string sql, params object?[] args)
    {
        var cmd = ds.CreateCommand(sql);
        foreach (var a in args) cmd.Parameters.Add(new NpgsqlParameter { Value = a ?? DBNull.Value });
        return cmd;
    }

    public static async Task<T?> ScalarAsync<T>(this NpgsqlDataSource ds, string sql, params object?[] args)
    {
        await using var cmd = ds.Cmd(sql, args);
        var v = await cmd.ExecuteScalarAsync();
        if (v is null or DBNull) return default;
        if (v is DateTime dt && typeof(T) == typeof(DateTimeOffset)) return (T)(object)new DateTimeOffset(DateTime.SpecifyKind(dt, DateTimeKind.Utc));  // timestamptz → DateTime UTC chez Npgsql
        return (T)v;
    }

    public static async Task<int> ExecAsync(this NpgsqlDataSource ds, string sql, params object?[] args)
    {
        await using var cmd = ds.Cmd(sql, args);
        return await cmd.ExecuteNonQueryAsync();
    }
}
