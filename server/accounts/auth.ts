import { sign, verify } from "hono/jwt";
import { env } from "../env";
import type { AccountStore, UserSummary } from "./account-store";

const issuer="yaozuo-local",audience="yaozuo-web",ttlSeconds=12*60*60;
export interface AuthIdentity { user:UserSummary;sessionId:string;token:string }

export async function issueToken(store:AccountStore,user:UserSummary){const iat=Math.floor(Date.now()/1000),exp=iat+ttlSeconds,expiresAt=new Date(exp*1000).toISOString();const session=store.createSession(user.id,expiresAt);const token=await sign({sub:user.id,sid:session.id,jti:session.jti,passwordVersion:session.passwordVersion,iat,exp,iss:issuer,aud:audience},env.jwtSecret,"HS256");return{token,tokenType:"Bearer" as const,expiresAt,user}}

export async function authenticate(store:AccountStore,authorization?:string,allowRevoked=false):Promise<AuthIdentity|undefined>{if(!authorization?.startsWith("Bearer "))return;const token=authorization.slice(7);try{const payload=await verify(token,env.jwtSecret,{alg:"HS256",iss:issuer,aud:audience});const userId=typeof payload.sub==="string"?payload.sub:"",sid=typeof payload.sid==="string"?payload.sid:"",jti=typeof payload.jti==="string"?payload.jti:"",version=typeof payload.passwordVersion==="number"?payload.passwordVersion:0;if(!userId||!sid||!jti||!version)return;const valid=store.validateSession(userId,sid,jti,version,allowRevoked);return valid?{user:valid.user,sessionId:sid,token}:undefined}catch{return}}
