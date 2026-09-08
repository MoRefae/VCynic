import { z } from "zod"; import { NextResponse } from "next/server";
const contact = z.object({name:z.string().trim().min(1).max(100),email:z.string().email().max(254),topic:z.string().trim().min(1).max(100),message:z.string().trim().min(1).max(4000),consent:z.literal(true)});
export async function POST(request:Request){try{contact.parse(await request.json()); return NextResponse.json({ok:true});}catch{return NextResponse.json({error:"Please complete the required fields and agree to the Privacy Policy."},{status:400});}}
