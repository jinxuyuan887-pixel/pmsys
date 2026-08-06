import type { CurrentUser } from "./auth";

type ProjectAccessPayload={managerIds?:number[];manager?:string};

export function isAdministrator(user:CurrentUser){
  return user.role.includes("管理员")||user.username==="ydleapadmin";
}

export function isProjectManager(user:CurrentUser,payload:ProjectAccessPayload){
  if(payload.managerIds?.length)return payload.managerIds.includes(user.id);
  return String(payload.manager??"").split(/[、,，]/).map(name=>name.trim()).includes(user.name);
}

export function canAccessProject(user:CurrentUser,payload:ProjectAccessPayload){
  return isAdministrator(user)||isProjectManager(user,payload);
}
