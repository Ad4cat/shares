import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { SignJWT } from "jose";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE || "http://localhost:8787";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const { path } = await params;
  return handleRequest(request, path, "GET");
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const { path } = await params;
  return handleRequest(request, path, "POST");
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const { path } = await params;
  return handleRequest(request, path, "PUT");
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const { path } = await params;
  return handleRequest(request, path, "DELETE");
}

async function handleRequest(
  request: NextRequest,
  pathSegments: string[],
  method: string
) {
  try {
    console.log(`[Proxy] ${method} request to:`, pathSegments);
    const first = (pathSegments[0] || "").toLowerCase();
    const allowAnonymous = first === "join";

    let userId: string | null = null;
    const authRes = await auth();
    userId = authRes.userId ?? null;
    console.log("[Proxy] User ID from Clerk auth():", userId);

    if (!userId && !allowAnonymous) {
      console.log("[Proxy] No userId from Clerk - returning 401");
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Special handling for download-url endpoint to return presigned URL directly
    if (pathSegments[0] === "download-url" && method === "GET") {
      const url = new URL(request.url);
      const mediaId = url.searchParams.get("id");

      if (!mediaId) {
        return NextResponse.json(
          { error: "Media ID is required" },
          { status: 400 }
        );
      }

      const targetUrl = `${API_BASE}/download-url?id=${mediaId}`;
      console.log("[Proxy] Target URL for download:", targetUrl);

      const headers = new Headers();
      headers.set("Content-Type", "application/json");

      if (userId) {
        const token = await generateJWT(userId);
        headers.set("Authorization", `Bearer ${token}`);
      }

      const response = await fetch(targetUrl, {
        method: "GET",
        headers,
      });

      if (!response.ok) {
        const errorData = await response.json();
        return NextResponse.json(errorData, { status: response.status });
      }

      const data = await response.json();

      // Return the actual file by redirecting to the presigned URL
      return NextResponse.redirect(data.url);
    }

    const path = pathSegments.join("/");
    const url = new URL(request.url);
    const targetUrl = `${API_BASE}/${path}${url.search}`;
    console.log("[Proxy] Target URL:", targetUrl);

    const headers = new Headers();
    headers.set("Content-Type", "application/json");

    // Add JWT token when user is authenticated (even for join endpoint)
    if (userId) {
      const token = await generateJWT(userId);
      console.log(
        "[Proxy] Generated JWT token:",
        token.substring(0, 50) + "..."
      );
      headers.set("Authorization", `Bearer ${token}`);
    }

    const body = method !== "GET" ? await request.text() : undefined;
    if (body) {
      console.log("[Proxy] Request body:", body);
    }

    console.log("[Proxy] Making request to Workers API...");
    const response = await fetch(targetUrl, {
      method,
      headers,
      body,
    });

    console.log("[Proxy] Workers API response status:", response.status);
    // Cloudflare 4xx/5xx で HTML テキストが返る場合があるため、JSON 以外も安全に処理する
    const contentType = response.headers.get("content-type") || "";
    let responseData: unknown;
    if (contentType.includes("application/json")) {
      try {
        responseData = await response.json();
      } catch {
        const txt = await response.text().catch(() => "");
        responseData = txt
          ? { error: txt }
          : { error: "Invalid JSON from upstream" };
      }
    } else {
      const txt = await response.text().catch(() => "");
      // 可能なら JSON パースを試み、失敗したらテキストを error としてラップ
      try {
        responseData = txt ? JSON.parse(txt) : {};
      } catch {
        responseData = txt
          ? { error: txt }
          : { error: "Upstream returned non-JSON response" };
      }
    }
    console.log("[Proxy] Workers API response:", responseData);

    return NextResponse.json(responseData as Record<string, unknown>, {
      status: response.status,
    });
  } catch (error) {
    console.error("[Proxy] Error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

async function generateJWT(userId: string): Promise<string> {
  const secret = new TextEncoder().encode(process.env.AUTH_SECRET || "");
  const jwt = await new SignJWT({})
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime("24h")
    .sign(secret);
  return jwt;
}
