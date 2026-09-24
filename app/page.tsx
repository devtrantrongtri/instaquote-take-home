import UploadForm from "../components/upload-form";

export default function HomePage() {
  return <main>
    <header className="page-header">
      <p className="eyebrow">Insta Quote AI · Document review</p>
      <h1>From PDF to source-backed items.</h1>
      <p>Extract line items, inspect their source, and see exactly what could not be read or needs review.</p>
    </header>
    <UploadForm />
    <footer>Version 1 reads supported text-based tables. Image-only pages cannot be read yet. Missing values are never calculated or filled in.</footer>
  </main>;
}
