import { useState, useEffect } from "react";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SIGNUPLOAD_URL = process.env.NEXT_PUBLIC_SIGNUPLOAD_URL; // https://.../functions/v1/signUpload

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

export default function Home() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [session, setSession] = useState(null);
  const [file, setFile] = useState(null);
  const [bucket, setBucket] = useState("evidencias");
  const [objectKey, setObjectKey] = useState("demo/archivo.pdf");
  const [privacy, setPrivacy] = useState("private");
  const [idempotency_key, setIdempotencyKey] = useState("id-demo-001");
  const [log, setLog] = useState("");

  useEffect(() => {
    // get initial session
    supabase.auth.getSession().then(({ data }) => setSession(data?.session || null));
    // listen for changes
    const { data: listener } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
    });
    return () => listener?.subscription?.unsubscribe();
  }, []);

  const appendLog = (txt) => {
    setLog((p) => `${p}${p ? "\n" : ""}${txt}`);
  };

  async function signup() {
    appendLog("Creando usuario...");
    const { error } = await supabase.auth.signUp({ email, password });
    if (error) appendLog("Signup error: " + error.message);
    else appendLog("Signup enviado: revisá tu email (si está habilitado).");
  }

  async function login() {
    appendLog("Logueando...");
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) appendLog("Login error: " + error.message);
    else appendLog("Login solicitado / completado.");
  }

  async function logout() {
    await supabase.auth.signOut();
    appendLog("Logout ok.");
  }

  // NUEVO: handleUpload completo con replace flow y manejo de errores
  async function handleUpload() {
    if (!session || !session.access_token) {
      appendLog("No estás logueada/o. Por favor logueate.");
      return;
    }
    if (!file) { appendLog("Selecciona un archivo."); return; }

    const doRequest = async (opts = { replace: false }) => {
      appendLog("Pidiendo signed URL a signUpload...");
      try {
        const registerBody = {
          bucket,
          objectKey,
          contentType: file.type || "application/octet-stream",
          checksum: "", // opcional
          entity_id: "00000000-0000-0000-0000-000000000001",
          idempotency_key,
          ...(opts.replace ? { replace: true } : {})
        };

        const resp = await fetch(SIGNUPLOAD_URL, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${session.access_token}`
          },
          body: JSON.stringify(registerBody)
        });

        // caso 409: conflicto (archivo existe / idempotency conflict)
        if (resp.status === 409) {
          let js = null;
          try { js = await resp.json(); } catch(e) { js = null; }
          appendLog("Respuesta 409: ya existe un archivo con ese nombre / conflicto de idempotencia.");
          const existingVersion = js?.existing?.version || js?.detail || "";
          const confirmReplace = window.confirm(
            `Ya existe un archivo con ese nombre ${existingVersion ? "(versión: "+existingVersion+")" : ""}.\n` +
            "¿Querés reemplazarlo (se creará una nueva versión)?\n\nAceptar = Reemplazar / Cancelar = Cambiar nombre"
          );
          if (confirmReplace) {
            appendLog("Usuario confirmó reemplazo. Reintentando con replace:true ...");
            return doRequest({ replace: true });
          } else {
            appendLog("Operación cancelada por usuario. Cambiá el nombre del archivo o idempotency_key.");
            return null;
          }
        }

        // error no-ok
        if (!resp.ok) {
          const txt = await resp.text().catch(()=>null);
          let parsed = null;
          try { parsed = JSON.parse(txt); } catch(e) { parsed = null; }
          appendLog("signUpload error: " + resp.status + " - " + (parsed?.error || txt || resp.statusText));
          return { error: true, status: resp.status, body: parsed || txt };
        }

        const js = await resp.json();
        const signedUrl = js.signedUrl || js.signed_url || js.uploadUrl || js.upload_url || js.signedUploadUrl;
        if (!signedUrl) {
          appendLog("No se obtuvo signedUrl: " + JSON.stringify(js));
          return { error: true, detail: "no_signed_url", body: js };
        }

        // OK, subir archivo con PUT
        appendLog("Subiendo el archivo al signed URL con PUT...");
        const putResp = await fetch(signedUrl, {
          method: "PUT",
          headers: {
            "Content-Type": file.type || "application/octet-stream"
          },
          body: file
        });
        if (!putResp.ok) {
          const txt2 = await putResp.text().catch(()=>null);
          appendLog("PUT error: " + putResp.status + " - " + (txt2 || putResp.statusText));
          return { error: true, status: putResp.status, body: txt2 };
        }

        appendLog("Archivo subido correctamente. Esperando webhook/registro en tabla documents.");
        return { ok: true, document_id: js.document_id || js.documentId || null, trace_id: js.trace_id || js.traceId || null };

      } catch (err) {
        appendLog("Exception: " + (err?.message || JSON.stringify(err)));
        return { error: true, exception: String(err) };
      }
    };

    // Ejecuta la petición
    const result = await doRequest();
    if (result && result.error && result.status === 500) {
      appendLog("\n(Servidor devolvió 500) Revisá Logs en Supabase Edge Functions -> signUpload -> Invocations/Logs");
    }
  }

  return (
    <div style={{ maxWidth: 820, margin: "2rem auto", fontFamily: "Arial, sans-serif" }}>
      <h1>Neocore — Demo: signup/login y signUpload</h1>

      <section style={{border: "1px solid #ddd", padding: 12, marginBottom:12}}>
        <h3>1) Config (Pegar tus datos)</h3>
        <p>Los valores se configuran en Vercel como variables de entorno:</p>
        <ul>
          <li><code>NEXT_PUBLIC_SUPABASE_URL</code></li>
          <li><code>NEXT_PUBLIC_SUPABASE_ANON_KEY</code></li>
          <li><code>NEXT_PUBLIC_SIGNUPLOAD_URL</code> (la URL de tu Edge Function)</li>
        </ul>
      </section>

      <section style={{border: "1px solid #ddd", padding: 12, marginBottom:12}}>
        <h3>2) Crear usuario de prueba / Login</h3>
        <label>Email<br/>
          <input value={email} onChange={e=>setEmail(e.target.value)} style={{width: "100%"}}/>
        </label>
        <label>Contraseña<br/>
          <input type="password" value={password} onChange={e=>setPassword(e.target.value)} style={{width:"100%"}}/>
        </label>
        <div style={{marginTop:8}}>
          <button onClick={signup}>Signup (crear)</button>{" "}
          <button onClick={login}>Login</button>{" "}
          <button onClick={logout}>Logout</button>
        </div>
      </section>

      <section style={{border: "1px solid #ddd", padding: 12, marginBottom:12}}>
        <h3>3) Formulario de subida (básico)</h3>
        <label>Archivo<br/>
          <input type="file" onChange={e=>setFile(e.target.files?.[0])}/>
        </label>
        <label>Bucket<br/>
          <input value={bucket} onChange={e=>setBucket(e.target.value)} style={{width:"100%"}}/>
        </label>
        <label>Object Key<br/>
          <input value={objectKey} onChange={e=>setObjectKey(e.target.value)} style={{width:"100%"}}/>
        </label>
        <label>Privacy<br/>
          <select value={privacy} onChange={e=>setPrivacy(e.target.value)}>
            <option value="private">private</option>
            <option value="project">project</option>
            <option value="public">public</option>
          </select>
        </label>
        <label>Idempotency key<br/>
          <input value={idempotency_key} onChange={e=>setIdempotencyKey(e.target.value)} style={{width:"100%"}}/>
        </label>
        <div style={{marginTop:8}}>
          <button onClick={handleUpload}>Pedir signed URL y subir archivo</button>
        </div>
      </section>

      <section style={{border: "1px solid #ddd", padding: 12}}>
        <h3>Resultado / Logs</h3>
        <pre style={{height:160, overflow:"auto", background:"#fafafa", padding:8, whiteSpace: "pre-wrap"}}>{log}</pre>
      </section>
    </div>
  );
}
