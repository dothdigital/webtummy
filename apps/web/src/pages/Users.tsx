import { useEffect, useState } from "react";
import { api } from "../api.js";
import type { AdminUser } from "../types.js";
import { ActionIconButton, Card, StatusPill } from "../components/ui.js";

function formatDate(value: string | null) {
  if (!value) return "-";
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(value));
}

export default function Users() {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const result = await api.get<{ users: AdminUser[] }>("/api/users");
      setUsers(result.users);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const verify = async (user: AdminUser) => {
    setBusyId(user.id);
    setMessage(null);
    try {
      const result = await api.patch<{ user: AdminUser }>(`/api/users/${user.id}/verify-email`, {});
      setUsers((current) => current.map((item) => (item.id === user.id ? result.user : item)));
      setMessage(`${user.email} is now verified.`);
    } catch (e) {
      setMessage(String(e));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-charcoal-800">User Management</h1>
        <p className="text-sm text-charcoal-400">Verify accounts manually when email delivery is not available.</p>
      </div>

      {message && <Card className="p-4 text-sm text-charcoal-600">{message}</Card>}

      <Card className="overflow-hidden">
        <div className="border-b border-charcoal-100 px-5 py-3 font-semibold text-charcoal-700">
          Users ({users.length})
        </div>
        {loading ? (
          <div className="p-6 text-sm text-charcoal-400">Loading users...</div>
        ) : users.length === 0 ? (
          <div className="p-6 text-sm text-charcoal-400">No users found.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[920px] text-sm">
              <thead className="bg-charcoal-50 text-left text-xs uppercase text-charcoal-400">
                <tr>
                  <th className="px-5 py-2">User</th>
                  <th className="px-5 py-2">Client</th>
                  <th className="px-5 py-2">Role</th>
                  <th className="px-5 py-2">Account</th>
                  <th className="px-5 py-2">Email</th>
                  <th className="px-5 py-2">Created</th>
                  <th className="px-5 py-2">Last login</th>
                  <th className="px-5 py-2 text-right">Action</th>
                </tr>
              </thead>
              <tbody>
                {users.map((user) => (
                  <tr key={user.id} className="border-t border-charcoal-50 align-middle">
                    <td className="px-5 py-3">
                      <div className="font-medium text-charcoal-800">{user.name ?? "-"}</div>
                      <div className="text-xs text-charcoal-400">{user.email}</div>
                    </td>
                    <td className="px-5 py-3 text-charcoal-600">{user.client?.name ?? "-"}</td>
                    <td className="px-5 py-3 text-charcoal-600">{user.role.replace("_", " ")}</td>
                    <td className="px-5 py-3">
                      <StatusPill status={user.isActive ? "active" : "inactive"} />
                    </td>
                    <td className="px-5 py-3">
                      <StatusPill status={user.emailVerifiedAt ? "verified" : "unverified"} />
                    </td>
                    <td className="px-5 py-3 text-charcoal-500">{formatDate(user.createdAt)}</td>
                    <td className="px-5 py-3 text-charcoal-500">{formatDate(user.lastLoginAt)}</td>
                    <td className="px-5 py-3 text-right">
                      {!user.emailVerifiedAt ? (
                        <div className="flex justify-end">
                          <ActionIconButton
                            icon="verify"
                            label={busyId === user.id ? "Verifying account" : "Verify account"}
                            onClick={() => verify(user)}
                            disabled={busyId === user.id}
                          />
                        </div>
                      ) : (
                        <span className="text-charcoal-400">Verified</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
