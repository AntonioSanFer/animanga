import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import type { UserStatus } from "../shared/types";
import {
  del,
  errorMessage,
  formatDate,
  patch,
  post,
  request,
  useMe,
  type AdminUser,
  type ItemsResponse,
} from "./api";
import { DownloadsList } from "./Downloads";
import { Empty, ErrorView, IconUsers, Loading } from "./ui";

export function AdminPage() {
  const me = useMe();
  const [tab, setTab] = useState<"users" | "downloads">("users");

  if (me.isPending) return <Loading label="Checking access…" />;
  if (!me.data || me.data.appUser.role !== "admin") return <div className="state">Admin only</div>;

  return (
    <>
      <h1>Admin</h1>
      <div className="tabs" role="tablist" aria-label="Admin sections">
        <button
          type="button"
          role="tab"
          aria-selected={tab === "users"}
          className={tab === "users" ? "tab active" : "tab"}
          onClick={() => setTab("users")}
        >
          <IconUsers />
          Users
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "downloads"}
          className={tab === "downloads" ? "tab active" : "tab"}
          onClick={() => setTab("downloads")}
        >
          Downloads
        </button>
      </div>

      {tab === "users" ? <UsersPanel selfEmail={me.data.user.email} /> : <DownloadsList isAdmin />}
    </>
  );
}

type UserPatch = { email: string; body: { role?: "admin" | "user"; status?: UserStatus } };

function UsersPanel({ selfEmail }: { selfEmail: string }) {
  const queryClient = useQueryClient();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"admin" | "user">("user");

  const users = useQuery({
    queryKey: ["admin", "users"],
    queryFn: () => request<ItemsResponse<AdminUser>>("/api/admin/users"),
  });

  const addUser = useMutation({
    mutationFn: (input: { email: string; role: "admin" | "user" }) =>
      post<{ ok: boolean }>("/api/admin/users", input),
    onSuccess: () => {
      setEmail("");
      queryClient.invalidateQueries({ queryKey: ["admin", "users"] });
    },
  });

  const updateUser = useMutation({
    mutationFn: (input: UserPatch) => patch<{ ok: boolean }>(`/api/admin/users/${encodeURIComponent(input.email)}`, input.body),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["admin", "users"] }),
  });

  const removeUser = useMutation({
    mutationFn: (target: AdminUser) => del<{ ok: boolean }>(`/api/admin/users/${encodeURIComponent(target.email)}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["admin", "users"] }),
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    addUser.mutate({ email: email.trim(), role });
  }

  const actionError = addUser.error ?? updateUser.error ?? removeUser.error;
  const pendingEmail = updateUser.isPending ? updateUser.variables?.email : removeUser.isPending ? removeUser.variables?.email : null;

  return (
    <>
      <form className="admin-form" onSubmit={submit}>
        <label className="field">
          <span>Email</span>
          <input
            className="input"
            type="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="person@example.com"
          />
        </label>
        <label className="field">
          <span>Role</span>
          <select className="select" value={role} onChange={(event) => setRole(event.target.value === "admin" ? "admin" : "user")}>
            <option value="user">User</option>
            <option value="admin">Admin</option>
          </select>
        </label>
        <button type="submit" className="btn btn-primary" disabled={addUser.isPending}>
          {addUser.isPending ? "Adding…" : "Pre-approve user"}
        </button>
      </form>

      {actionError && (
        <p className="form-error" role="alert">
          {errorMessage(actionError)}
        </p>
      )}

      {users.isPending && <Loading label="Loading users…" />}
      {users.isError && <ErrorView error={users.error} onRetry={() => users.refetch()} />}

      {users.isSuccess && users.data.items.length === 0 && <Empty>No users yet.</Empty>}

      {users.data && users.data.items.length > 0 && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Email</th>
                <th>Name</th>
                <th>Role</th>
                <th>Status</th>
                <th>Favourites</th>
                <th>Last login</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {users.data.items.map((user) => {
                const isSelf = user.email.toLowerCase() === selfEmail.toLowerCase();
                const busy = pendingEmail === user.email;
                return (
                  <tr key={user.email}>
                    <td>{user.email}</td>
                    <td>{user.name || "—"}</td>
                    <td>
                      <span className={`badge ${user.role === "admin" ? "badge-accent" : ""}`}>{user.role}</span>
                    </td>
                    <td>
                      <span className={`badge badge-${user.status}`}>{user.status}</span>
                    </td>
                    <td>{user.favourites}</td>
                    <td>{formatDate(user.lastLoginAt)}</td>
                    <td>
                      {isSelf ? (
                        <span className="muted">You</span>
                      ) : (
                        <div className="actions">
                          {user.status !== "active" && (
                            <button
                              type="button"
                              className="btn btn-sm"
                              disabled={busy}
                              onClick={() => updateUser.mutate({ email: user.email, body: { status: "active" } })}
                            >
                              Approve
                            </button>
                          )}
                          {user.status !== "blocked" && (
                            <button
                              type="button"
                              className="btn btn-sm btn-ghost"
                              disabled={busy}
                              onClick={() => updateUser.mutate({ email: user.email, body: { status: "blocked" } })}
                            >
                              Block
                            </button>
                          )}
                          <button
                            type="button"
                            className="btn btn-sm btn-ghost"
                            disabled={busy}
                            onClick={() =>
                              updateUser.mutate({
                                email: user.email,
                                body: { role: user.role === "admin" ? "user" : "admin" },
                              })
                            }
                          >
                            {user.role === "admin" ? "Make user" : "Make admin"}
                          </button>
                          <button
                            type="button"
                            className="btn btn-sm btn-danger"
                            disabled={busy}
                            onClick={() => {
                              if (window.confirm(`Delete ${user.email}?`)) removeUser.mutate(user);
                            }}
                          >
                            Delete
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
