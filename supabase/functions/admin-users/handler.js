const ROLES = ["administrador", "comercial", "consulta"];
export async function createInvitedUser(input, token, adapter) {
  if (!token)
    return { status: 401, error: "Inicia sesión para crear usuarios." };
  const actor = await adapter.authorize(token);
  if (!actor)
    return {
      status: 403,
      error: "Solo un administrador activo puede crear usuarios.",
    };
  const name = String(input.full_name || "").trim();
  const email = String(input.email || "")
    .trim()
    .toLowerCase();
  const role = input.role;
  if (
    !name ||
    name.length > 150 ||
    email.length > 254 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
    !ROLES.includes(role)
  )
    return {
      status: 400,
      error: "Revisa el nombre, correo y rol del nuevo usuario.",
    };
  const invitation = await adapter.invite(email, name);
  if (invitation.error || !invitation.id)
    return {
      status: 409,
      error:
        "No se pudo crear la invitación. Si el correo ya está registrado, administra su cuenta en la lista. Si no, revisa el servicio de correo o inténtalo más tarde.",
    };
  try {
    await adapter.activate(invitation.id, actor, name, role);
  } catch {
    return {
      status: 409,
      error:
        "La invitación se creó, pero no se pudo activar el acceso. Actualiza la lista y revisa el usuario antes de volver a invitarlo.",
    };
  }
  return {
    status: 201,
    id: invitation.id,
    message:
      "Usuario creado y rol asignado. Se solicitó el correo de invitación para que establezca su contraseña.",
  };
}
