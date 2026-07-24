import json
import sys

from sentence_transformers import SentenceTransformer


def main() -> None:
    model_name = sys.argv[1]
    request = json.load(sys.stdin)
    model = SentenceTransformer(model_name)
    embeddings = model.encode(
        request["texts"],
        normalize_embeddings=True,
        show_progress_bar=False,
    )
    json.dump({"embeddings": embeddings.tolist()}, sys.stdout, separators=(",", ":"))


if __name__ == "__main__":
    main()
