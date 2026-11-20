        headers: { "Content-Type": "application/json" }
      });
    }

    return new Response("Unknown command", { status: 400 });
