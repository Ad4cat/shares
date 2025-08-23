"use client";

import { useEffect, useState } from "react";
import { useUser, SignInButton, SignUpButton, UserButton } from "@clerk/nextjs";
import { useRouter } from "next/navigation";
import { apiClient } from "@/lib/api";

export default function HomePage() {
  const { user, isLoaded } = useUser();
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [myGroupId, setMyGroupId] = useState<string | null>(null);

  useEffect(() => {
    const fetchActive = async () => {
      if (!user) return;
      try {
        const res = await apiClient.getActiveGroup();
        setMyGroupId(res.id);
      } catch (e) {
        // noop
      }
    };
    fetchActive();
  }, [user]);

  const handleCreateGroup = async () => {
    console.log("[Page] User object:", user);
    console.log("[Page] User ID:", user?.id);
    if (!user?.id) {
      console.log("[Page] No user ID, cannot create group");
      return;
    }

    setIsLoading(true);
    setError("");

    try {
      console.log("[Page] Calling apiClient.createGroup()");
      const result = await apiClient.createGroup();
      console.log("[Page] Group created:", result);
      // Pass initial members data via URL state if possible, or use localStorage
      localStorage.setItem(
        `group-${result.id}-initial-members`,
        JSON.stringify(result.members)
      );
      router.push(`/group?id=${result.id}`);
    } catch (error) {
      console.error("[Page] Group creation failed:", error);
      setError("グループの作成に失敗しました");
    } finally {
      setIsLoading(false);
    }
  };

  const handleJoinGroup = () => {
    router.push("/join");
  };

  if (!isLoaded) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">読み込み中...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100">
      <div className="container mx-auto px-4 py-16">
        <div className="max-w-md mx-auto bg-white rounded-lg shadow-lg p-8">
          <div className="text-center mb-8">
            <h1 className="text-3xl font-bold text-gray-900 mb-2">TripShare</h1>
            <p className="text-gray-600">一時的な写真・動画共有アプリ</p>
          </div>

          {!user ? (
            <div className="space-y-4">
              <div className="text-center mb-6">
                <p className="text-gray-600 mb-4">
                  Googleアカウントでサインインしてください
                </p>
              </div>

              <div className="space-y-3">
                <div className="w-full">
                  <SignInButton mode="modal">
                    <button className="w-full bg-blue-600 text-white py-2 px-4 rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500">
                      サインイン
                    </button>
                  </SignInButton>
                </div>

                <div className="w-full">
                  <SignUpButton mode="modal">
                    <button className="w-full bg-green-600 text-white py-2 px-4 rounded-md hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-green-500">
                      アカウント作成
                    </button>
                  </SignUpButton>
                </div>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="text-center">
                <p className="text-gray-600 mb-2">
                  ようこそ、
                  <span className="font-semibold">
                    {user.firstName || user.emailAddresses[0]?.emailAddress}
                  </span>
                  さん
                </p>
                <div className="flex justify-center mb-4">
                  <UserButton />
                </div>
              </div>

              <div className="space-y-3">
                {myGroupId ? (
                  <>
                    <button
                      onClick={() => router.push(`/group?id=${myGroupId}`)}
                      className="w-full bg-purple-600 text-white py-2 px-4 rounded-md hover:bg-purple-700 focus:outline-none focus:ring-2 focus:ring-purple-500"
                    >
                      グループを開く
                    </button>
                    <button
                      onClick={handleJoinGroup}
                      className="w-full bg-blue-600 text-white py-2 px-4 rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      招待リンクで参加
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      onClick={handleCreateGroup}
                      disabled={isLoading}
                      className="w-full bg-green-600 text-white py-2 px-4 rounded-md hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-green-500 disabled:opacity-50"
                    >
                      {isLoading ? "作成中..." : "グループを作成"}
                    </button>
                    <button
                      onClick={handleJoinGroup}
                      className="w-full bg-blue-600 text-white py-2 px-4 rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      招待リンクで参加
                    </button>
                  </>
                )}
              </div>

              {error && (
                <div className="text-red-600 text-sm text-center">{error}</div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
