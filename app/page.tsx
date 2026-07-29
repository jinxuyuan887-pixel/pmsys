import DashboardApp from "./ui/DashboardApp";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { userForToken } from "./auth";

export const dynamic = "force-dynamic";

export default async function Home() {
  const store=await cookies();
  const user=await userForToken(store.get("eap_session")?.value??null);
  if(!user)redirect("/login");
  return <DashboardApp currentUser={user}/>;
}
