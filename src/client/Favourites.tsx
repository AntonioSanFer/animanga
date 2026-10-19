import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { Favourite } from "../shared/types";
import { del, errorMessage, useFavourites } from "./api";
import { hasProgress } from "./bits";
import { Link } from "./router";
import { Cover, Empty, ErrorView, IconTrash, Loading } from "./ui";

function FavouriteCard({
  favourite,
  removing,
  onRemove,
}: {
  favourite: Favourite;
  removing: boolean;
  onRemove: () => void;
}) {
  return (
    <div className="fav-card">
      <Link to={favourite.kind === "manga" ? `/manga/${favourite.sourceId}` : `/anime/${favourite.sourceId}`} className="card">
        <Cover src={favourite.cover} alt={`Cover of ${favourite.title}`} />
        <span className="card-title">{favourite.title}</span>
        <span className="card-meta capitalize">{favourite.kind}</span>
        {hasProgress(favourite.kind, favourite.sourceId) && <span className="badge badge-accent">Continue</span>}
      </Link>
      <button
        type="button"
        className="fav-remove"
        aria-label={`Remove ${favourite.title} from favourites`}
        disabled={removing}
        onClick={onRemove}
      >
        <IconTrash />
      </button>
    </div>
  );
}

export function FavouritesPage() {
  const queryClient = useQueryClient();
  const favourites = useFavourites();

  const remove = useMutation({
    mutationFn: (favourite: Favourite) =>
      del<{ ok: boolean }>(
        `/api/favourites/${favourite.kind}/${encodeURIComponent(favourite.sourceId)}`,
      ),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["favourites"] }),
  });

  const items = favourites.data?.items ?? [];
  const manga = items.filter((item) => item.kind === "manga");
  const anime = items.filter((item) => item.kind === "anime");

  return (
    <>
      <h1>Favourites</h1>

      {favourites.isPending && <Loading label="Loading favourites…" />}
      {favourites.isError && <ErrorView error={favourites.error} onRetry={() => favourites.refetch()} />}
      {remove.isError && (
        <p className="form-error" role="alert">
          {errorMessage(remove.error)}
        </p>
      )}
      {favourites.isSuccess && items.length === 0 && (
        <Empty>
          <p>No favourites yet.</p>
          <p>
            Browse <Link to="/manga">manga</Link> or <Link to="/anime">anime</Link> and tap Favourite.
          </p>
        </Empty>
      )}

      {manga.length > 0 && (
        <section className="section">
          <div className="section-head">
            <h2>Manga</h2>
          </div>
          <div className="grid">
            {manga.map((favourite) => (
              <FavouriteCard
                key={favourite.sourceId}
                favourite={favourite}
                removing={
                  remove.isPending &&
                  remove.variables?.kind === favourite.kind &&
                  remove.variables.sourceId === favourite.sourceId
                }
                onRemove={() => remove.mutate(favourite)}
              />
            ))}
          </div>
        </section>
      )}

      {anime.length > 0 && (
        <section className="section">
          <div className="section-head">
            <h2>Anime</h2>
          </div>
          <div className="grid">
            {anime.map((favourite) => (
              <FavouriteCard
                key={favourite.sourceId}
                favourite={favourite}
                removing={
                  remove.isPending &&
                  remove.variables?.kind === favourite.kind &&
                  remove.variables.sourceId === favourite.sourceId
                }
                onRemove={() => remove.mutate(favourite)}
              />
            ))}
          </div>
        </section>
      )}
    </>
  );
}
