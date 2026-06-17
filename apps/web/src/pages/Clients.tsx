// Super-admin: list clients + create a client (name + domain to scan).
import { useEffect, useState } from "react";
import { api } from "../api.js";
import type { Client } from "../types.js";
import { Button, Card, Input } from "../components/ui.js";

export default function Clients() {
  const [clients, setClients] = useState<Client[]>([]);
  const [name, setName] = useState("");
  const [domain, setDomain] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const load = () => api.get<{ clients: Client[] }>("/api/clients").then((r) => setClients(r.clients));
  useEffect(() => { load(); }, []);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name || !domain) return;
    setBusy(true);
    setMsg(null);
    try {
      await api.post("/api/clients", { name, domain });
      setName(""); setDomain("");
      setMsg("Client + project created. Go to Projects to run a crawl.");
      await load();
    } catch (e) {
      setMsg(String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-charcoal-800">Clients</h1>
        <p className="text-sm text-charcoal-400">Add a client and the first project domain you want to scan.</p>
      </div>

      <Card className="p-5">
        <h3 className="mb-4 font-semibold text-charcoal-700">New client</h3>
        <form onSubmit={create} className="grid grid-cols-1 gap-4 md:grid-cols-[1fr_1fr_auto] md:items-end">
          <Input label="Client name" value={name} onChange={setName} placeholder="Acme Corp" />
          <Input label="Domain to scan" value={domain} onChange={setDomain} placeholder="example.com" />
          <Button type="submit" disabled={busy}>{busy ? "Creating…" : "Add client"}</Button>
        </form>
        {msg && <div className="mt-3 text-sm text-charcoal-500">{msg}</div>}
      </Card>

      <Card className="overflow-hidden">
        <div className="border-b border-charcoal-100 px-5 py-3 font-semibold text-charcoal-700">
          All clients ({clients.length})
        </div>
        {clients.length === 0 ? (
          <div className="p-6 text-sm text-charcoal-400">No clients yet.</div>
        ) : (
          <div className="overflow-x-auto"><table className="w-full min-w-[560px] text-sm">
            <thead className="bg-charcoal-50 text-left text-xs uppercase text-charcoal-400">
              <tr>
                <th className="px-5 py-2">Name</th>
                <th className="px-5 py-2">Plan</th>
                <th className="px-5 py-2">Projects</th>
                <th className="px-5 py-2">Created</th>
              </tr>
            </thead>
            <tbody>
              {clients.map((c) => (
                <tr key={c.id} className="border-t border-charcoal-50">
                  <td className="px-5 py-3 font-medium text-charcoal-700">{c.name}</td>
                  <td className="px-5 py-3 capitalize">{c.plan}</td>
                  <td className="px-5 py-3">{c._count?.websites ?? 0}</td>
                  <td className="px-5 py-3 text-charcoal-400">
                    {new Date(c.createdAt).toLocaleDateString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table></div>
        )}
      </Card>
    </div>
  );
}
