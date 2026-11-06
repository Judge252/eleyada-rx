export type AppRole = "doctor" | "pharmacist";
export type Account = {
  id: string;
  email: string;
  role: AppRole;
  pharmacy: { id: string; name: string } | null;
};

export const roleHome = (role: AppRole) =>
  role === "doctor" ? "/" : "/portal";

export function validMembership(
  row: {
    role: string;
    is_active: boolean;
    pharmacy_id: string | null;
  } | null,
): row is { role: AppRole; is_active: true; pharmacy_id: string | null } {
  return (
    !!row?.is_active &&
    ((row.role === "doctor" && row.pharmacy_id === null) ||
      (row.role === "pharmacist" && !!row.pharmacy_id))
  );
}
