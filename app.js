      const LOCAL_MOVIE_SUGGESTIONS = [
        "Inception", "Interstellar", "The Dark Knight", "The Matrix", "Avatar", "Titanic",
        "The Godfather", "Pulp Fiction", "Fight Club", "Forrest Gump", "Gladiator", "The Shawshank Redemption",
        "Oppenheimer", "Dune", "Dune: Part Two", "Mad Max: Fury Road", "The Batman", "Joker",
        "Spider-Man: No Way Home", "Avengers: Endgame", "Iron Man", "Black Panther", "Doctor Strange",
        "The Lord of the Rings", "The Hobbit", "Harry Potter", "Star Wars", "Jurassic Park", "Top Gun: Maverick",
        "Mission: Impossible", "John Wick", "The Lion King", "Frozen", "Coco", "Inside Out",
        "Whiplash", "Parasite", "La La Land", "The Social Network", "Blade Runner 2049", "The Prestige"
      ];

      const MAX_SUGGESTIONS = 8;
      let selectedSuggestionIndex = -1;
      let latestQuery = "";
      let remoteAbortController;
      let pendingRemoteTimer;

      const titleInput = document.getElementById("title");
      const searchBtn = document.getElementById("searchBtn");
      const statusEl = document.getElementById("status");
      const resultsEl = document.getElementById("results");
      const suggestionsEl = document.getElementById("suggestions");

      async function getMoviePosters(title) {
        if (!title || !title.trim()) throw new Error("A movie title is required.");
        const response = await fetch(`/api/scrape?movie=${encodeURIComponent(title)}`);
        const payload = await response.json();

        if (!response.ok) {
          throw new Error(payload?.error || "Could not fetch posters from the server.");
        }

        return Array.isArray(payload?.posters) ? payload.posters : [];
      }

      function rankAndLimitLocalSuggestions(query) {
        const q = query.trim().toLowerCase();
        if (!q) return [];

        const startsWith = LOCAL_MOVIE_SUGGESTIONS.filter((title) => title.toLowerCase().startsWith(q));
        const contains = LOCAL_MOVIE_SUGGESTIONS.filter((title) => !title.toLowerCase().startsWith(q) && title.toLowerCase().includes(q));
        return [...startsWith, ...contains].slice(0, MAX_SUGGESTIONS);
      }

      function normalizeWikiTitle(title) {
        return title
          .replace(/\s*\([^)]*film[^)]*\)\s*/gi, "")
          .replace(/\s*\([^)]*movie[^)]*\)\s*/gi, "")
          .replace(/\s+/g, " ")
          .trim();
      }

      async function fetchRemoteSuggestions(query) {
        if (!query.trim()) return [];

        if (remoteAbortController) {
          remoteAbortController.abort();
        }

        remoteAbortController = new AbortController();
        const wikiUrl = `https://en.wikipedia.org/w/api.php?action=query&list=search&format=json&origin=*&srlimit=12&srsearch=${encodeURIComponent(`${query} film`)}`;

        try {
          const response = await fetch(wikiUrl, { signal: remoteAbortController.signal });
          if (!response.ok) return [];

          const payload = await response.json();
          const results = payload?.query?.search || [];

          return results
            .map((item) => normalizeWikiTitle(item?.title || ""))
            .filter(Boolean)
            .slice(0, MAX_SUGGESTIONS);
        } catch (error) {
          if (error.name === "AbortError") return [];
          return [];
        }
      }

      function mergeSuggestions(localSuggestions, remoteSuggestions, query) {
        const q = query.trim().toLowerCase();
        const merged = [];
        const seen = new Set();

        const all = [...localSuggestions, ...remoteSuggestions];
        all.forEach((title) => {
          const cleanTitle = title.trim();
          const key = cleanTitle.toLowerCase();
          if (!cleanTitle || seen.has(key)) return;
          seen.add(key);
          merged.push(cleanTitle);
        });

        return merged
          .sort((a, b) => {
            const aStarts = a.toLowerCase().startsWith(q) ? 1 : 0;
            const bStarts = b.toLowerCase().startsWith(q) ? 1 : 0;
            if (aStarts !== bStarts) return bStarts - aStarts;
            return a.localeCompare(b);
          })
          .slice(0, MAX_SUGGESTIONS);
      }

      function hideSuggestions() {
        suggestionsEl.hidden = true;
        suggestionsEl.innerHTML = "";
        selectedSuggestionIndex = -1;
      }

      function renderSuggestions(suggestions) {
        if (!suggestions.length) {
          hideSuggestions();
          return;
        }

        suggestionsEl.innerHTML = "";
        suggestions.forEach((title, index) => {
          const li = document.createElement("li");
          const btn = document.createElement("button");
          btn.type = "button";
          btn.className = "suggestion-btn";
          btn.textContent = title;
          btn.addEventListener("mousedown", (event) => {
            event.preventDefault();
            titleInput.value = title;
            hideSuggestions();
          });

          if (index === selectedSuggestionIndex) {
            btn.classList.add("active");
          }

          li.appendChild(btn);
          suggestionsEl.appendChild(li);
        });

        suggestionsEl.hidden = false;
      }

      function renderSuggestionText(message) {
        suggestionsEl.innerHTML = `<li><span class="suggestion-text">${message}</span></li>`;
        suggestionsEl.hidden = false;
      }

      async function updateSuggestions(query) {
        const trimmed = query.trim();
        latestQuery = trimmed;

        if (!trimmed) {
          hideSuggestions();
          return;
        }

        const localSuggestions = rankAndLimitLocalSuggestions(trimmed);
        if (localSuggestions.length) {
          renderSuggestions(localSuggestions);
        } else {
          renderSuggestionText("Searching more movie titles...");
        }

        const remoteSuggestions = await fetchRemoteSuggestions(trimmed);

        if (latestQuery !== trimmed) {
          return;
        }

        const mergedSuggestions = mergeSuggestions(localSuggestions, remoteSuggestions, trimmed);
        if (!mergedSuggestions.length) {
          renderSuggestionText("No suggestions found. Keep typing...");
          return;
        }

        renderSuggestions(mergedSuggestions);
      }

      titleInput.addEventListener("input", () => {
        selectedSuggestionIndex = -1;

        clearTimeout(pendingRemoteTimer);
        const query = titleInput.value;
        pendingRemoteTimer = setTimeout(() => {
          updateSuggestions(query);
        }, 180);
      });

      titleInput.addEventListener("keydown", (event) => {
        const buttons = [...suggestionsEl.querySelectorAll(".suggestion-btn")];
        if (!buttons.length || suggestionsEl.hidden) return;

        if (event.key === "ArrowDown") {
          event.preventDefault();
          selectedSuggestionIndex = (selectedSuggestionIndex + 1) % buttons.length;
          renderSuggestions(buttons.map((button) => button.textContent));
        } else if (event.key === "ArrowUp") {
          event.preventDefault();
          selectedSuggestionIndex = (selectedSuggestionIndex - 1 + buttons.length) % buttons.length;
          renderSuggestions(buttons.map((button) => button.textContent));
        } else if (event.key === "Enter" && selectedSuggestionIndex >= 0) {
          event.preventDefault();
          titleInput.value = buttons[selectedSuggestionIndex].textContent;
          hideSuggestions();
        } else if (event.key === "Escape") {
          hideSuggestions();
        }
      });

      document.addEventListener("click", (event) => {
        if (!suggestionsEl.contains(event.target) && event.target !== titleInput) {
          hideSuggestions();
        }
      });

      searchBtn.addEventListener("click", async () => {
        const title = titleInput.value.trim();
        hideSuggestions();
        statusEl.className = "status";
        statusEl.textContent = "Searching...";
        resultsEl.innerHTML = "";
        searchBtn.disabled = true;

        try {
          const posters = await getMoviePosters(title);
          if (!posters.length) {
            statusEl.textContent = "No JPG/JPEG poster URLs found.";
            return;
          }

          statusEl.textContent = `Found ${posters.length} poster URL(s):`;
          for (const url of posters) {
            const li = document.createElement("li");
            const a = document.createElement("a");
            a.href = url;
            a.target = "_blank";
            a.rel = "noopener noreferrer";
            a.textContent = url;
            li.appendChild(a);
            resultsEl.appendChild(li);
          }
        } catch (err) {
          statusEl.className = "status error";
          statusEl.textContent = err.message;
        } finally {
          searchBtn.disabled = false;
        }
      });
