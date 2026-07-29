"use client";
import { useState } from "react";

export default function LoginForm(){
  const [error,setError]=useState(""),[loading,setLoading]=useState(false);
  async function login(form:FormData){
    setLoading(true);setError("");
    const response=await fetch("/api/auth/login",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({username:String(form.get("username")),password:String(form.get("password"))})});
    const data=await response.json() as {error?:string};
    if(!response.ok){setError(data.error??"登录失败");setLoading(false);return}
    window.location.href="/";
  }
  return <main className="login-page"><section className="login-card"><div className="login-brand"><span>♥</span><strong>EAP 项目管理</strong></div><h1>登录管理系统</h1><p>项目、服务记录与交付数据统一管理</p>
    <form action={login}><label>登录账号<input name="username" autoComplete="username" required placeholder="请输入登录账号"/></label><label>登录密码<input name="password" type="password" autoComplete="current-password" required placeholder="请输入登录密码"/></label>
      {error&&<div className="login-error">{error}</div>}<button className="primary" disabled={loading}>{loading?"正在登录…":"登录系统"}</button></form>
    <small>外部咨询师请使用项目经理发送的专属填报链接，无需登录。</small></section></main>;
}
