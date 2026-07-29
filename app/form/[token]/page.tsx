import ExternalServiceForm from "./service-form";

export default async function FormPage({params}:{params:Promise<{token:string}>}) {
  const {token}=await params;
  return <ExternalServiceForm token={token}/>;
}
