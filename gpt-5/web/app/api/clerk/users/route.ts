import { NextRequest, NextResponse } from "next/server";
import { clerkClient } from "@clerk/nextjs/server";

export async function GET(request: NextRequest) {
  try {
    const url = new URL(request.url);
    const idsParam = url.searchParams.get("ids");

    if (!idsParam) {
      return NextResponse.json(
        { error: "ids query param is required" },
        { status: 400 }
      );
    }

    const userIds = idsParam
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
      .slice(0, 50);

    // Clerkは未知のIDが混在しているとエラーを返す場合があるため、存在しないIDをフィルタする
    // まずはIDごとに個別取得（失敗は握りつぶしてフォールバック）
    const client = await clerkClient();
    const entries: Array<[string, { name: string; imageUrl: string }]> = [];
    for (const id of userIds) {
      try {
        const u = await client.users.getUser(id);
        const name =
          [u.firstName, u.lastName].filter(Boolean).join(" ") ||
          u.username ||
          u.primaryEmailAddress?.emailAddress ||
          u.id;
        entries.push([id, { name, imageUrl: u.imageUrl || "" }]);
      } catch {
        entries.push([id, { name: id, imageUrl: "" }]);
      }
    }

    const map: Record<string, { name: string; imageUrl: string }> = {};
    for (const [id, info] of entries) map[id] = info;

    return NextResponse.json({ users: map });
  } catch {
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
