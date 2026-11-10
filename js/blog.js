fetch("./talks.json")
    .then((response) => response.json())
    .then((posts) => {
    console.log(posts);
        const container = document.getElementById("posts");
        posts.forEach((post) => {
            const div = document.createElement("div");
            div.className = "post";
            div.innerHTML = `
        <div class="post-content">
          <div class="post-title">
            <a href="${post.url}">${post.title}</a>
          </div>
          <div class="post-description">${post.description}</div>
          <div class="post-meta">Last updated on ${post.date}</div>
        </div>
        <img style="margin-top: 40px" src="${post.image}" alt="${post.title}">
      `;
            container.appendChild(div);
        });
    });
