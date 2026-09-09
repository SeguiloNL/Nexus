"use server";

import { logout } from "@/app/(auth)/actions";

export async function logoutAction() {
  await logout();
}
