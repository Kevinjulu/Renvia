export function generateStaticParams() {
  return [{ slug: "hello-world" }];
}

export default async function BlogPostPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  return (
    <main className="flex min-h-screen items-center justify-center">
      <h1 className="text-2xl font-semibold">Blog post: {slug}</h1>
    </main>
  );
}
