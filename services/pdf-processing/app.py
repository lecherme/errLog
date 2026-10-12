"""Group 1 placeholder for the PDF Processing Service (task 1.1).

Exists only so the local compose skeleton has a reachable `pdf-processing`
container. Task 3.1 replaces it with the real PyMuPDF service; `GET /` here is a
container readiness probe, not that service's health contract.
"""

from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

PORT = 8000


class PlaceholderHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path != "/":
            self.send_error(404)
            return
        body = b"pdf-processing placeholder\n"
        self.send_response(200)
        self.send_header("Content-Type", "text/plain; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


if __name__ == "__main__":
    # All interfaces inside the container network namespace only; compose.yaml
    # publishes no host port for this service.
    ThreadingHTTPServer(("0.0.0.0", PORT), PlaceholderHandler).serve_forever()
