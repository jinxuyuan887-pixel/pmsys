export const recordTypeOptions=["讲座／团辅活动记录","心理咨询台账","培训活动记录","驻场服务记录","EAP宣传记录","心理测评记录"] as const;

export type ServiceRecordType=(typeof recordTypeOptions)[number];

export function recordTypeForServiceName(serviceName:string):ServiceRecordType{
  const name=String(serviceName??"").trim();
  if(name.includes("咨询"))return "心理咨询台账";
  if(name.includes("讲座")||name.includes("团辅"))return "讲座／团辅活动记录";
  if(name.includes("培训"))return "培训活动记录";
  if(name.includes("测评"))return "心理测评记录";
  if(name.includes("宣传")||name.includes("课程"))return "EAP宣传记录";
  if(name.includes("驻场"))return "驻场服务记录";
  return "讲座／团辅活动记录";
}
